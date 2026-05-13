'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import type {
  Paginated,
  SearchHit,
  SearchMode,
  SearchRequest,
  SearchResult,
} from '@/lib/api/types';

export type SearchKind = 'documents' | 'entities';

export interface UnifiedEntityRow {
  id: string;
  name: string;
  type: string;
}

export interface UnifiedDocumentsResult {
  hits: SearchHit[];
  total: number;
  mode: SearchMode;
}

export interface UnifiedEntitiesResult {
  items: UnifiedEntityRow[];
  total: number;
}

export interface UseUnifiedSearchOptions {
  query: string;
  mode?: SearchMode;
  filters?: SearchRequest['filters'];
  documentLimit?: number;
  entityLimit?: number;
  kinds?: readonly SearchKind[];
  /** Override the shared 200 ms debounce. */
  debounceMs?: number;
  /** Minimum input length to fire requests (default 1). */
  minQueryLength?: number;
}

export interface UseUnifiedSearchResult {
  /** The post-debounce query that produced the current results. */
  debounced: string;
  documents: UnifiedDocumentsResult | null;
  entities: UnifiedEntitiesResult | null;
  isFetchingDocuments: boolean;
  isFetchingEntities: boolean;
  isFetching: boolean;
  errorDocuments: unknown;
  errorEntities: unknown;
}

const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_KINDS: readonly SearchKind[] = ['documents', 'entities'];

// Single shared debounce + two parallel React Query subscriptions. Components
// pass a `kinds` array to skip whichever section they don't need (the graph
// page wants entities only; the palette wants both).
export function useUnifiedSearch(options: UseUnifiedSearchOptions): UseUnifiedSearchResult {
  const {
    query,
    mode = 'hybrid',
    filters,
    documentLimit = 8,
    entityLimit = 8,
    kinds = DEFAULT_KINDS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    minQueryLength = 1,
  } = options;

  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), debounceMs);
    return () => window.clearTimeout(id);
  }, [query, debounceMs]);

  const enabled = debounced.length >= minQueryLength;
  const wantDocuments = enabled && kinds.includes('documents');
  const wantEntities = enabled && kinds.includes('entities');

  // Stringify filters into the query key so changing a filter triggers a
  // refetch without us having to enumerate every field.
  const filterKey = filters ? JSON.stringify(filters) : '';

  const docsQuery = useQuery({
    queryKey: ['unified-search', 'documents', debounced, mode, documentLimit, filterKey] as const,
    enabled: wantDocuments,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.post<SearchResult>('/search', {
        query: debounced,
        mode,
        limit: documentLimit,
        ...(filters ? { filters } : {}),
      }),
  });

  const entitiesQuery = useQuery({
    queryKey: ['unified-search', 'entities', debounced, entityLimit] as const,
    enabled: wantEntities,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<Paginated<UnifiedEntityRow>>('/graph/entities', {
        query: { q: debounced, limit: entityLimit },
      }),
  });

  // Drop results once the input is cleared so stale hits don't linger in the
  // UI between sessions of the palette.
  const documents: UnifiedDocumentsResult | null = !enabled
    ? null
    : docsQuery.data
      ? { hits: docsQuery.data.hits, total: docsQuery.data.total, mode: docsQuery.data.mode }
      : null;
  const entities: UnifiedEntitiesResult | null = !enabled
    ? null
    : entitiesQuery.data
      ? { items: entitiesQuery.data.items, total: entitiesQuery.data.total }
      : null;

  return {
    debounced,
    documents,
    entities,
    isFetchingDocuments: wantDocuments && docsQuery.isFetching,
    isFetchingEntities: wantEntities && entitiesQuery.isFetching,
    isFetching:
      (wantDocuments && docsQuery.isFetching) || (wantEntities && entitiesQuery.isFetching),
    errorDocuments: docsQuery.error,
    errorEntities: entitiesQuery.error,
  };
}
