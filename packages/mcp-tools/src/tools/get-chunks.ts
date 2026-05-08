import type { McpToolContext } from '../context.js';
import {
  type GetChunksInput,
  GetChunksInputSchema,
  type GetChunksOutput,
  GetChunksOutputSchema,
} from '../schemas.js';

export const GET_CHUNKS_TOOL = {
  name: 'mnela_get_chunks',
  description: 'Return the ordered chunks of a document by id.',
  scope: 'read_only' as const,
  inputSchema: GetChunksInputSchema,
  outputSchema: GetChunksOutputSchema,
};

export async function getChunks(
  input: GetChunksInput,
  ctx: McpToolContext,
): Promise<GetChunksOutput> {
  const chunks = await ctx.documents.getChunks(input.documentId);
  return {
    chunks: chunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      text: c.text,
      tokenCount: c.tokenCount,
    })),
  };
}
