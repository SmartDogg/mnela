import type { SearchFilters } from '@mnela/search';

import type { McpToolContext } from '../context.js';
import {
  type SearchInput,
  SearchInputSchema,
  type SearchOutput,
  SearchOutputSchema,
} from '../schemas.js';

const DEFAULT_LIMIT = 20;

export const SEARCH_TOOL = {
  name: 'mnela_search',
  description:
    'Search documents via FTS+trigram hybrid. Multi-value filters (projects/types/sources) accept arrays but the MVP narrows to the first value; full multi-value support lands later.',
  scope: 'read_only' as const,
  inputSchema: SearchInputSchema,
  outputSchema: SearchOutputSchema,
};

function toFilters(input: SearchInput['filters']): SearchFilters | undefined {
  if (!input) return undefined;
  const out: SearchFilters = {};
  // MVP: search adapter accepts a single value per axis; pick the first.
  if (input.projects && input.projects.length > 0 && input.projects[0]) {
    out.projectSlug = input.projects[0];
  }
  if (input.types && input.types.length > 0 && input.types[0]) {
    out.type = input.types[0];
  }
  if (input.sources && input.sources.length > 0 && input.sources[0]) {
    out.source = input.sources[0];
  }
  if (input.dateFrom) out.dateFrom = new Date(input.dateFrom);
  if (input.dateTo) out.dateTo = new Date(input.dateTo);
  if (input.languages && input.languages.length > 0) out.languages = input.languages;
  return Object.keys(out).length === 0 ? undefined : out;
}

export async function search(input: SearchInput, ctx: McpToolContext): Promise<SearchOutput> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const filters = toFilters(input.filters);
  const result = await ctx.search.search({
    query: input.query,
    ...(filters ? { filters } : {}),
    page: 1,
    limit,
  });
  return {
    documents: result.hits.map((h) => {
      const out: { id: string; title: string; snippet?: string; score: number } = {
        id: h.documentId,
        title: h.title,
        score: h.score,
      };
      if (h.snippet) out.snippet = h.snippet;
      return out;
    }),
    totalCount: result.total,
  };
}
