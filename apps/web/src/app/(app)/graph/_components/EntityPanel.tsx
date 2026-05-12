'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitMerge, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { EntityMergeDialog } from '@/components/entity-merge-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import type { DocumentSummary, EntitySummary, Paginated } from '@/lib/api/types';

interface EntityPanelProps {
  entityId: string;
  onClose: () => void;
  /** Set the graph center to this entity (re-runs the neighborhood query). */
  onSetCenter: (entityId: string) => void;
  /** Pulled from the in-graph node so the header is instant; backing fetch fills in details. */
  initialName?: string;
  initialType?: string;
}

type EntityDetail = EntitySummary;

interface NeighborhoodNode {
  data: { id: string; label: string; type: string };
}

interface NeighborhoodEdge {
  data: { id: string; source: string; target: string; label: string };
}

interface NeighborhoodResponse {
  center: string;
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
}

export function EntityPanel({
  entityId,
  onClose,
  onSetCenter,
  initialName,
  initialType,
}: EntityPanelProps): JSX.Element {
  const t = useTranslations('graph.entityPanel');

  const entityQuery = useQuery({
    queryKey: ['graph-entity', entityId],
    queryFn: () => api.get<EntityDetail>(`/graph/entities/${encodeURIComponent(entityId)}`),
  });

  // Recent documents that mention this entity. We rely on the documents
  // endpoint accepting an entityId filter; if it doesn't, the response is
  // simply empty and the panel still renders cleanly.
  const documentsQuery = useQuery({
    queryKey: ['graph-entity-documents', entityId],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>('/documents', {
        query: { entityId, limit: 8, page: 1 },
      }),
    retry: false,
  });

  // Pull the entity's 1-hop neighborhood to surface adjacent project entities.
  const neighborhoodQuery = useQuery({
    queryKey: ['graph-entity-neighborhood', entityId],
    queryFn: () =>
      api.get<NeighborhoodResponse>('/graph', {
        query: { center: entityId, depth: 1 },
      }),
  });

  const projectNodes = (neighborhoodQuery.data?.nodes ?? []).filter(
    (n) => n.data.type === 'project' && n.data.id !== entityId,
  );

  const entity = entityQuery.data;
  const name = entity?.name ?? initialName ?? entityId;
  const type = entity?.type ?? initialType ?? 'entity';
  const [mergeOpen, setMergeOpen] = useState(false);

  return (
    <aside className="flex w-80 min-w-0 shrink-0 flex-col overflow-hidden border-l bg-background">
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-sm font-semibold" title={name}>
            {name}
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
              {type}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">
              {entityId.slice(0, 8)}…
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label={t('close')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-w-0 flex-1">
        <div className="w-full min-w-0 space-y-4 break-words px-3 pb-6 pt-3">
          {entity?.description && (
            <Section label={t('description')}>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {entity.description}
              </p>
            </Section>
          )}

          {entity?.aliases && entity.aliases.length > 0 && (
            <Section label={t('aliases')}>
              <div className="flex flex-wrap gap-1">
                {entity.aliases.map((a) => (
                  <Badge key={a} variant="secondary" className="font-mono text-[10px]">
                    {a}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          <Section label={t('actions')}>
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full justify-start text-xs"
                onClick={() => onSetCenter(entityId)}
              >
                {t('setCenter')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full justify-start text-xs"
                disabled={!entity || entity.mergedIntoId !== null}
                onClick={() => setMergeOpen(true)}
              >
                <GitMerge className="size-3" />
                <span className="ml-1.5">{t('mergeInto')}</span>
              </Button>
            </div>
          </Section>

          <Section label={t('projects')}>
            {neighborhoodQuery.isLoading ? (
              <Skeleton className="h-6 w-full" />
            ) : projectNodes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('emptyProjects')}</p>
            ) : (
              <ul className="space-y-1">
                {projectNodes.map((p) => (
                  <li key={p.data.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => onSetCenter(p.data.id)}
                    >
                      <span className="truncate">{p.data.label}</span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        project
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section label={t('documents')}>
            {documentsQuery.isLoading && <Skeleton className="h-6 w-full" />}
            {documentsQuery.error !== null && documentsQuery.error !== undefined && (
              <p className="text-xs text-muted-foreground">{t('emptyDocuments')}</p>
            )}
            {documentsQuery.data && documentsQuery.data.items.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('emptyDocuments')}</p>
            )}
            {documentsQuery.data && documentsQuery.data.items.length > 0 && (
              <ul className="space-y-1">
                {documentsQuery.data.items.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/documents/${doc.id}`}
                      className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
                    >
                      <span className="truncate">{doc.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </ScrollArea>
      {entity && <EntityMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} source={entity} />}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      {children}
    </div>
  );
}
