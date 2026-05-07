import type { DocumentStatus, SourceType } from '@prisma/client';

export type SearchMode = 'fts' | 'fuzzy' | 'hybrid';

export interface SearchFilters {
  status?: DocumentStatus;
  source?: SourceType;
  type?: string;
  projectSlug?: string;
}

export interface SearchOptions {
  query: string;
  filters?: SearchFilters;
  page?: number;
  limit?: number;
}

export interface SearchHit {
  documentId: string;
  title: string;
  snippet?: string;
  score: number;
  ftsRank?: number;
  trigramSimilarity?: number;
}

export interface SearchResult {
  mode: SearchMode;
  hits: SearchHit[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchAdapter {
  readonly mode: SearchMode;
  search(options: SearchOptions): Promise<SearchResult>;
}

export const FTS_LANGUAGE = 'russian';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;

export interface HybridSearchConfig {
  ftsWeight: number;
  trigramWeight: number;
  trigramThreshold: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  ftsWeight: 0.7,
  trigramWeight: 0.3,
  trigramThreshold: 0.3,
};
