'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useLiveSocketStore } from '@/lib/socket/store';
import type { Edge as GraphEdge, Entity as GraphEntity, MnelaGraphHandle } from '@mnela/ui';
import type { GraphEdgeLike, GraphEntityLike } from '@/lib/socket/types';

// Cytoscape needs `window` — dynamic-import keeps it out of the SSR bundle and
// out of jsdom test runs that don't render this component.
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
  const handleRef = useRef<MnelaGraphHandle | null>(null);
  const seenNodes = useRef<Set<string>>(new Set());
  const seenEdges = useRef<Set<string>>(new Set());

  // Subscribe to the live store as plain Map snapshots; useShallow keeps the
  // tuple identity stable when nothing relevant changed.
  const { nodes, edges } = useLiveSocketStore(
    useShallow((s) => ({ nodes: s.graphNodes, edges: s.graphEdges })),
  );

  // Imperatively stream new nodes/edges into Cytoscape on each store update.
  // We diff against `seenNodes`/`seenEdges` rather than re-passing the full
  // arrays so the existing fadeIn/pulse animations only fire on additions.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const newNodes: GraphEntity[] = [];
    nodes.forEach((node, id) => {
      if (!seenNodes.current.has(id)) {
        seenNodes.current.add(id);
        newNodes.push(toEntity(node));
      }
    });
    if (newNodes.length > 0) handle.appendNodes(newNodes);
  }, [nodes]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const newEdges: GraphEdge[] = [];
    edges.forEach((edge, id) => {
      if (!seenEdges.current.has(id)) {
        seenEdges.current.add(id);
        newEdges.push(toEdge(edge));
      }
    });
    if (newEdges.length > 0) handle.appendEdges(newEdges);
  }, [edges]);

  // Hydrate any nodes/edges that were already in the store before the graph
  // mounted (e.g. when navigating back to a running import).
  const handleReady = (handle: MnelaGraphHandle | null): void => {
    handleRef.current = handle;
    if (!handle) return;
    const initialNodes: GraphEntity[] = [];
    nodes.forEach((node, id) => {
      if (!seenNodes.current.has(id)) {
        seenNodes.current.add(id);
        initialNodes.push(toEntity(node));
      }
    });
    if (initialNodes.length > 0) handle.appendNodes(initialNodes);
    const initialEdges: GraphEdge[] = [];
    edges.forEach((edge, id) => {
      if (!seenEdges.current.has(id)) {
        seenEdges.current.add(id);
        initialEdges.push(toEdge(edge));
      }
    });
    if (initialEdges.length > 0) handle.appendEdges(initialEdges);
  };

  const empty = nodes.size === 0 && edges.size === 0;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-2 top-2 z-10 rounded bg-zinc-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        {t('graphLive')} · {nodes.size}n / {edges.size}e
      </div>
      <MnelaGraph ref={handleReady} nodes={[]} edges={[]} layout="cose" miniMap />
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
