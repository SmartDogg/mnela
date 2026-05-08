import type { McpToolContext } from '../context.js';
import {
  type ArchiveDocumentInput,
  ArchiveDocumentInputSchema,
  type ArchiveDocumentOutput,
  ArchiveDocumentOutputSchema,
} from '../schemas.js';

export const ARCHIVE_DOCUMENT_TOOL = {
  name: 'mnela_archive_document',
  description: 'Soft-archive a document (sets archivedAt and status=archived).',
  scope: 'mcp' as const,
  inputSchema: ArchiveDocumentInputSchema,
  outputSchema: ArchiveDocumentOutputSchema,
  audit: {
    action: 'mcp.archive_document',
    targetType: 'Document',
    targetIdFrom: 'input' as const,
    targetIdPath: 'id',
  },
};

export async function archiveDocument(
  input: ArchiveDocumentInput,
  ctx: McpToolContext,
): Promise<ArchiveDocumentOutput> {
  await ctx.documents.update(input.id, { archived: true });
  return { ok: true };
}
