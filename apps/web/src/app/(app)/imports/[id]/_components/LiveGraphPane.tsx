'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useLiveSocketStore } from '@/lib/socket/store';
import type { Edge as GraphEdge, Entity as GraphEntity } from '@mnela/ui';
import type { GraphEdgeLike, GraphEntityLike } from '@/lib/socket/types';

// MnelaGraph uses HTMLCanvasElement + window — dynamic import keeps it out
// of the SSR bundle and skips it during jsdom tests that don't mount it.
const MnelaGraph = dynamic(() => import('@mnela/ui').then((m) => ({ default: m.MnelaGraph })), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full items-center justify-center text-xs text-muted-foreground"
      data-testid="graph-loading"
    >
      …
    </div>
  ),
});

interface LiveGraphPaneProps {
  jobId: string;
}

function toEntity(node: GraphEntityLike): GraphEntity {
  return { id: node.id, name: node.name, type: node.type };
}

function toEdge(edge: GraphEdgeLike): GraphEdge {
  return {
    id: edge.id,
    fromId: edge.fromId,
    toId: edge.toId,
    relationType: edge.relationType,
    status: 'auto_confirmed',
    confidence: 1,
  };
}

export function LiveGraphPane({ jobId: _jobId }: LiveGraphPaneProps): JSX.Element {
  const t = useTranslations('imports.detail');

  const { nodes, edges } = useLiveSocketStore(
    useShallow((s) => ({ nodes: s.graphNodes, edges: s.graphEdges })),
  );

  // Force-graph reconciles position state across renders by node id, so it's
  // safe (and simpler) to pass the full materialized arrays from the store
  // instead of streaming individual additions.
  const nodeArray = useMemo(() => Array.from(nodes.values()).map(toEntity), [nodes]);
  const edgeArray = useMemo(() => Array.from(edges.values()).map(toEdge), [edges]);

  const empty = nodes.size === 0 && edges.size === 0;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-2 top-2 z-10 rounded bg-zinc-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        {t('graphLive')} · {nodes.size}n / {edges.size}e
      </div>
      <MnelaGraph nodes={nodeArray} edges={edgeArray} miniMap />
      {empty && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
          data-testid="graph-empty"
        >
          {t('graphEmpty')}
        </div>
      )}
    </div>
  );
}
