'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useLiveSocketStore } from '@/lib/socket/store';
import type { Edge as GraphEdge, Entity as GraphEntity, MnelaGraphHandle } from '@mnela/ui';
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

/**
 * Live import graph. Drives the canvas via MnelaGraph's imperative ref so
 * each live `graph.node_added` / `graph.edge_added` event becomes a
 * targeted `appendNodes` / `appendEdges` call — d3-force keeps existing
 * positions, the camera stays put, and new entries fade in via the
 * renderer's `__addedAt` painters. The old approach re-rendered with
 * fresh node arrays on every event, which rebooted the simulation and
 * made the layout jump.
 */
export function LiveGraphPane({ jobId: _jobId }: LiveGraphPaneProps): JSX.Element {
  const t = useTranslations('imports.detail');

  const { nodes, edges } = useLiveSocketStore(
    useShallow((s) => ({ nodes: s.graphNodes, edges: s.graphEdges })),
  );

  const graphRef = useRef<MnelaGraphHandle | null>(null);
  // Track which ids have already been pushed to the canvas so a Zustand
  // re-render only forwards genuinely new entries through the ref API.
  const seenNodeIds = useRef<Set<string>>(new Set());
  const seenEdgeIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handle = graphRef.current;
    if (!handle) return;
    const newNodes: GraphEntity[] = [];
    for (const n of nodes.values()) {
      if (!seenNodeIds.current.has(n.id)) {
        seenNodeIds.current.add(n.id);
        newNodes.push(toEntity(n));
      }
    }
    if (newNodes.length > 0) handle.appendNodes(newNodes);
  }, [nodes]);

  useEffect(() => {
    const handle = graphRef.current;
    if (!handle) return;
    const newEdges: GraphEdge[] = [];
    for (const e of edges.values()) {
      if (!seenEdgeIds.current.has(e.id)) {
        seenEdgeIds.current.add(e.id);
        newEdges.push(toEdge(e));
      }
    }
    if (newEdges.length > 0) handle.appendEdges(newEdges);
  }, [edges]);

  const empty = nodes.size === 0 && edges.size === 0;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-2 top-2 z-10 rounded bg-zinc-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        {t('graphLive')} · {nodes.size}n / {edges.size}e
      </div>
      {/* The graph mounts with empty props; everything is streamed in via
          the ref handle from the effects above. */}
      <MnelaGraph ref={graphRef} nodes={EMPTY_NODES} edges={EMPTY_EDGES} miniMap />
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

// Stable empty arrays so the underlying useMemo([nodes, edges]) never
// trips a needless recompute — the imperative ref is the only update path.
const EMPTY_NODES: GraphEntity[] = [];
const EMPTY_EDGES: GraphEdge[] = [];
