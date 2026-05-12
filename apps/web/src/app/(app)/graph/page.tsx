'use client';

import type { Edge as GraphEdge, Entity as GraphEntity } from '@mnela/ui';
import { Activity, Loader2, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EdgeEditorDialog, type EdgeEditorTarget } from '@/components/edge-editor-dialog';
import { Button } from '@/components/ui/button';
import { EntityPanel } from './_components/EntityPanel';
import { FilterSidebar } from './_components/FilterSidebar';
import { GraphView, type GraphViewHandle } from './_components/GraphView';
import { SearchBar } from './_components/SearchBar';
import { TruncatedBanner } from './_components/TruncatedBanner';
import {
  DEFAULT_FILTERS,
  type GraphFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
} from './_components/filterState';
import { useGraphQuery } from './_components/use-graph-query';

export default function GraphPage(): JSX.Element {
  const t = useTranslations('graph');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<GraphFilters>(() =>
    filtersFromSearchParams(searchParams.toString()),
  );
  const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EdgeEditorTarget | null>(null);
  // Live search text — feeds the canvas's highlight overlay every keystroke
  // without going through React Query, so typing is instant.
  const [searchText, setSearchText] = useState('');
  const graphRef = useRef<GraphViewHandle | null>(null);

  // Sync filter changes back to the URL without remounting the page. We
  // strip the stored layout/selection because they're transient UI state.
  const lastSerialized = useRef<string>('');
  useEffect(() => {
    const params = filtersToSearchParams(filters);
    const next = params.toString();
    if (next === lastSerialized.current) return;
    lastSerialized.current = next;
    const url = next ? `?${next}` : '';
    router.replace(`/graph${url}`, { scroll: false });
  }, [filters, router]);

  const graphQuery = useGraphQuery(filters);

  const nodes = graphQuery.data?.nodes ?? [];
  const edges = graphQuery.data?.edges ?? [];
  const stats = graphQuery.data?.stats;

  const handleNodeClick = useCallback((entity: GraphEntity) => {
    setSelectedEntity(entity);
  }, []);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdge({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      relationType: edge.relationType,
      confidence: edge.confidence,
      status:
        edge.status === 'auto_confirmed' ||
        edge.status === 'needs_review' ||
        edge.status === 'manual' ||
        edge.status === 'rejected'
          ? (edge.status as EdgeEditorTarget['status'])
          : 'manual',
    });
  }, []);

  const handleSetCenter = useCallback((entityId: string) => {
    setFilters((prev) => ({ ...prev, center: entityId }));
    setSelectedEntity(null);
  }, []);

  const handleMatchInGraph = useCallback(
    (q: string) => {
      setSearchText(q);
      if (!q) return;
      // Best-effort pan: if any node matches, centre the camera on it so the
      // user sees what they're typing about. The canvas's `highlightQuery`
      // prop also lights up every match in parallel.
      const lower = q.toLowerCase();
      const match = nodes.find((n) => n.name.toLowerCase().includes(lower));
      if (match) graphRef.current?.centerOn(match.id);
    },
    [nodes],
  );

  const reset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS, center: filters.center });
  }, [filters.center]);

  const truncated = stats?.truncated === true;
  const isOverview = !filters.center;

  const headerSubtitle = useMemo(() => {
    if (!stats) return t('subtitle');
    if (isOverview) {
      return t('overviewStats', {
        nodes: stats.returnedNodes,
        edges: stats.returnedEdges,
      });
    }
    return t('stats', {
      nodes: stats.returnedNodes,
      edges: stats.returnedEdges,
    });
  }, [isOverview, stats, t]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar: search + stats + layout */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">{t('title')}</h1>
          <SearchBar
            onMatchInGraph={handleMatchInGraph}
            onPickCenter={handleSetCenter}
            placeholder={filters.center ? t('search.replaceCenter') : t('search.pickCenter')}
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {graphQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          <span className="font-mono tabular-nums">{headerSubtitle}</span>
          <div className="inline-flex items-center rounded-md border bg-background p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              aria-label={t('actions.reheat')}
              title={t('actions.reheat')}
              onClick={() => graphRef.current?.reheat()}
            >
              <Activity className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              aria-label={t('actions.fit')}
              title={t('actions.fit')}
              onClick={() => graphRef.current?.fit()}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <FilterSidebar filters={filters} onChange={setFilters} onReset={reset} />

        <div className="relative flex flex-1 flex-col">
          {truncated && stats && (
            <TruncatedBanner returnedNodes={stats.returnedNodes} totalNodes={stats.totalNodes} />
          )}
          <div className="relative flex-1">
            {graphQuery.error !== null && graphQuery.error !== undefined && (
              <ErrorState message={errorMessage(graphQuery.error)} />
            )}
            <GraphView
              ref={graphRef}
              nodes={nodes}
              edges={edges}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              highlightQuery={searchText}
            />
            {isOverview && stats && stats.returnedNodes > 0 && (
              <div className="pointer-events-none absolute left-4 top-3 max-w-md">
                <div className="pointer-events-auto rounded-md border border-white/5 bg-black/40 px-2.5 py-1.5 text-[11px] text-white/70 backdrop-blur-md">
                  <span className="font-mono uppercase tracking-wider text-white/40">
                    {t('overview.badge')}
                  </span>
                  <span className="ml-2">{t('overview.hint')}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedEntity && (
          <EntityPanel
            entityId={selectedEntity.id}
            initialName={selectedEntity.name}
            initialType={selectedEntity.type}
            onClose={() => setSelectedEntity(null)}
            onSetCenter={handleSetCenter}
          />
        )}
      </div>
      {selectedEdge && (
        <EdgeEditorDialog
          open={selectedEdge !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedEdge(null);
          }}
          edge={selectedEdge}
          fromName={nodes.find((n) => n.id === selectedEdge.fromId)?.name}
          toName={nodes.find((n) => n.id === selectedEdge.toId)?.name}
        />
      )}
    </div>
  );
}

function ErrorState({ message }: { message: string }): JSX.Element {
  const t = useTranslations('graph');
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a]">
      <div className="max-w-sm space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-center">
        <h2 className="text-sm font-medium text-destructive">{t('error.title')}</h2>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
