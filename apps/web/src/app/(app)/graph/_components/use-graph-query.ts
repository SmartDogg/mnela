'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Edge as GraphEdge, Entity as GraphEntity } from '@mnela/ui';

import { api } from '@/lib/api/client';

import { filtersToApiQuery, type GraphFilters } from './filterState';

// API contract (mirrors apps/api/src/modules/graph/graph.service.ts).
// Nodes/edges arrive as `{ data: {...} }` objects. We adapt them to the
// `Entity`/`Edge` shapes consumed by `<MnelaGraph>` once, here.
export interface GraphApiNode {
  data: {
    id: string;
    label: string;
    type: string;
    description?: string;
    /** Present only on the overview endpoint. */
    degree?: number;
  };
}

export interface GraphApiEdge {
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    confidence: number;
    status: string;
  };
}

export interface GraphApiStats {
  totalNodes: number;
  totalEdges: number;
  returnedNodes: number;
  returnedEdges: number;
  truncated: boolean;
}

export interface GraphApiResponse {
  center: string;
  nodes: GraphApiNode[];
  edges: GraphApiEdge[];
  stats: GraphApiStats;
}

export interface GraphSnapshot {
  center: string;
  nodes: GraphEntity[];
  edges: GraphEdge[];
  stats: GraphApiStats;
}

function adapt(response: GraphApiResponse, confirmedOnly: boolean): GraphSnapshot {
  const nodes: GraphEntity[] = response.nodes.map((n) => ({
    id: n.data.id,
    name: n.data.label,
    type: n.data.type,
    // Surface degree as a free-form attribute so the renderer can size nodes
    // proportionally on the overview view (absent on neighborhood snapshots).
    ...(typeof n.data.degree === 'number'
      ? { attributes: { degree: n.data.degree } satisfies Record<string, unknown> }
      : {}),
  }));
  const edgesAll: GraphEdge[] = response.edges.map((e) => ({
    id: e.data.id,
    fromId: e.data.source,
    toId: e.data.target,
    relationType: e.data.label,
    status: e.data.status,
    confidence: e.data.confidence,
  }));
  const edges = confirmedOnly
    ? edgesAll.filter((e) => e.status === 'auto_confirmed' || e.status === 'manual')
    : edgesAll;
  return { center: response.center, nodes, edges, stats: response.stats };
}

export interface UseGraphQueryResult {
  data: GraphSnapshot | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

// Apply client-side filters on top of the fetched snapshot. Lets the user
// toggle types / relations / confidence / confirmed-only without re-hitting
// the server — the response is already a representative slice, and filtering
// in JS gives instant feedback. Server-side filters (depth, projectSlug, date
// window) still drive the actual fetch via `queryKey` below.
function applyClientFilters(snap: GraphSnapshot, filters: GraphFilters): GraphSnapshot {
  let nodes = snap.nodes;
  let edges = snap.edges;

  if (filters.types.length > 0) {
    const allowed = new Set(filters.types);
    nodes = nodes.filter((n) => allowed.has(n.type as (typeof filters.types)[number]));
  }
  if (filters.relations.length > 0) {
    const allowed = new Set(filters.relations);
    edges = edges.filter((e) => allowed.has(e.relationType));
  }
  if (filters.confidence > 0) {
    edges = edges.filter((e) => e.confidence >= filters.confidence);
  }
  if (filters.confirmedOnly) {
    edges = edges.filter((e) => e.status === 'auto_confirmed' || e.status === 'manual');
  }
  // Drop edges whose endpoints didn't survive the type filter.
  if (filters.types.length > 0) {
    const validIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => validIds.has(e.fromId) && validIds.has(e.toId));
  }

  return {
    center: snap.center,
    nodes,
    edges,
    stats: {
      ...snap.stats,
      returnedNodes: nodes.length,
      returnedEdges: edges.length,
    },
  };
}

export function useGraphQuery(filters: GraphFilters): UseGraphQueryResult {
  const apiQuery = filtersToApiQuery(filters);
  // Always enabled now: an empty center kicks off the overview ("zero-state")
  // query so the page is never blank on first paint.
  const overviewMode = apiQuery === null;
  const overviewLimit = 200;

  // Two stable query keys — one for overview, one for neighborhood. We do
  // NOT include client-only filter fields (types, relations, confidence,
  // confirmedOnly) in the key so toggling them doesn't trigger a refetch.
  const query = useQuery({
    queryKey: overviewMode
      ? (['graph', 'overview', overviewLimit] as const)
      : ([
          'graph',
          apiQuery.center,
          apiQuery.depth,
          apiQuery.projectSlug,
          apiQuery.from,
          apiQuery.to,
        ] as const),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async (): Promise<GraphSnapshot> => {
      if (overviewMode) {
        const response = await api.get<GraphApiResponse>('/graph/overview', {
          query: { limit: overviewLimit },
        });
        // confirmedOnly is applied client-side too; keep adapt neutral.
        return adapt(response, false);
      }
      const response = await api.get<GraphApiResponse>('/graph', {
        query: {
          center: apiQuery.center,
          depth: apiQuery.depth,
          // depth / center / date / project go to the server because they
          // change which subgraph is fetched — types/relations/confidence
          // are filtered locally below for instant UI response.
          projectSlug: apiQuery.projectSlug,
          from: apiQuery.from,
          to: apiQuery.to,
        },
      });
      return adapt(response, false);
    },
    select: (snap) => applyClientFilters(snap, filters),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
