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

export function useGraphQuery(filters: GraphFilters): UseGraphQueryResult {
  const apiQuery = filtersToApiQuery(filters);
  const enabled = apiQuery !== null;

  const query = useQuery({
    queryKey: ['graph', apiQuery],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<GraphSnapshot> => {
      // `enabled` guards against null; satisfy the type-checker.
      if (!apiQuery) throw new Error('No center selected');
      // The api client's query record accepts string | number | boolean; types
      // and relations are already comma-joined strings.
      const response = await api.get<GraphApiResponse>('/graph', {
        query: {
          center: apiQuery.center,
          depth: apiQuery.depth,
          types: apiQuery.types,
          relations: apiQuery.relations,
          projectSlug: apiQuery.projectSlug,
          from: apiQuery.from,
          to: apiQuery.to,
          confidence: apiQuery.confidence,
        },
      });
      return adapt(response, filters.confirmedOnly);
    },
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
