import type { McpToolContext } from '../context.js';
import {
  type GetDocumentInput,
  GetDocumentInputSchema,
  type GetDocumentOutput,
  GetDocumentOutputSchema,
} from '../schemas.js';

export const GET_DOCUMENT_TOOL = {
  name: 'mnela_get_document',
  description: 'Fetch a document with its chunks by id.',
  scope: 'read_only' as const,
  inputSchema: GetDocumentInputSchema,
  outputSchema: GetDocumentOutputSchema,
};

export async function getDocument(
  input: GetDocumentInput,
  ctx: McpToolContext,
): Promise<GetDocumentOutput> {
  const doc = await ctx.documents.findById(input.id);
  if (!doc) {
    throw new Error(`document not found: ${input.id}`);
  }
  const chunks = await ctx.documents.getChunks(input.id);
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    status: doc.status,
    language: doc.language,
    type: doc.type,
    rawText: doc.rawText,
    cleanText: doc.cleanText,
    tokenCount: doc.tokenCount,
    createdAt: doc.createdAt.toISOString(),
    chunks: chunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      text: c.text,
      tokenCount: c.tokenCount,
    })),
  };
}
