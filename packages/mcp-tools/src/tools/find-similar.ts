import type { McpToolContext } from '../context.js';
import {
  type FindSimilarInput,
  FindSimilarInputSchema,
  type FindSimilarOutput,
  FindSimilarOutputSchema,
} from '../schemas.js';

const DEFAULT_LIMIT = 10;

export const FIND_SIMILAR_TOOL = {
  name: 'mnela_find_similar',
  description: 'Find documents semantically similar to the provided text via FTS + trigram.',
  scope: 'read_only' as const,
  inputSchema: FindSimilarInputSchema,
  outputSchema: FindSimilarOutputSchema,
};

export async function findSimilar(
  input: FindSimilarInput,
  ctx: McpToolContext,
): Promise<FindSimilarOutput> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const hits = await ctx.search.findSimilar(input.text, limit);
  const filtered = input.excludeDocumentId
    ? hits.filter((h) => h.documentId !== input.excludeDocumentId)
    : hits;

  return {
    documents: filtered.map((h) => {
      const summary: { id: string; title: string; snippet?: string; score: number } = {
        id: h.documentId,
        title: h.title,
        score: h.score,
      };
      if (h.snippet) summary.snippet = h.snippet;
      return summary;
    }),
  };
}
