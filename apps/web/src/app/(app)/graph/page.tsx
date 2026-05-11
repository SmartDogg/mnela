'use client';

import type { Edge as GraphEdge, Entity as GraphEntity, MnelaGraphLayout } from '@mnela/ui';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EdgeEditorDialog, type EdgeEditorTarget } from '@/components/edge-editor-dialog';
import { EntityPanel } from './_components/EntityPanel';
import { FilterSidebar } from './_components/FilterSidebar';
import { GraphView, type GraphViewHandle } from './_components/GraphView';
import { LayoutSwitcher } from './_components/LayoutSwitcher';
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
  const [layout, setLayout] = useState<MnelaGraphLayout>('cose');
  const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EdgeEditorTarget | null>(null);
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
      if (!q) return;
      const lower = q.toLowerCase();
      const match = nodes.find((n) => n.name.toLowerCase().includes(lower));
      if (match) graphRef.current?.centerOn(match.id);
    },
    [nodes],
  );

  const reset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS, center: filters.center });
  }, [filters.center]);

  const showEmpty = !filters.center && !graphQuery.isLoading;
  const truncated = stats?.truncated === true;

  const headerSubtitle = useMemo(() => {
    if (!stats) return t('subtitle');
    return t('stats', {
      nodes: stats.returnedNodes,
      edges: stats.returnedEdges,
    });
  }, [stats, t]);

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
          <LayoutSwitcher value={layout} onChange={setLayout} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <FilterSidebar filters={filters} onChange={setFilters} onReset={reset} />

        <div className="relative flex flex-1 flex-col">
          {truncated && stats && (
            <TruncatedBanner returnedNodes={stats.returnedNodes} totalNodes={stats.totalNodes} />
          )}
          <div className="relative flex-1">
            {showEmpty && <EmptyState />}
            {!showEmpty && graphQuery.error !== null && graphQuery.error !== undefined && (
              <ErrorState message={errorMessage(graphQuery.error)} />
            )}
            {!showEmpty && (
              <GraphView
                ref={graphRef}
                nodes={nodes}
                edges={edges}
                layout={layout}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
              />
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

function EmptyState(): JSX.Element {
  const t = useTranslations('graph');
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a]">
      <div className="max-w-sm space-y-2 text-center">
        <h2 className="text-sm font-medium text-foreground">{t('empty.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('empty.subtitle')}</p>
      </div>
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
