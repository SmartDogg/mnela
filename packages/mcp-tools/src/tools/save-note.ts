import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type SaveNoteInput,
  SaveNoteInputSchema,
  type SaveNoteOutput,
  SaveNoteOutputSchema,
} from '../schemas.js';

export const SAVE_NOTE_TOOL = {
  name: 'mnela_save_note',
  description:
    'Persist a free-form note as a Document. Optionally attaches it to projects by slug. Indexing/enrichment run via the regular pipelines.',
  scope: 'mcp' as const,
  inputSchema: SaveNoteInputSchema,
  outputSchema: SaveNoteOutputSchema,
  audit: {
    action: 'mcp.save_note',
    targetType: 'Document',
    targetIdFrom: 'output' as const,
    targetIdPath: 'documentId',
  },
};

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function saveNote(input: SaveNoteInput, ctx: McpToolContext): Promise<SaveNoteOutput> {
  const contentHash = sha256Hex(input.content);
  const source = input.source ?? 'manual_upload';
  const type = input.type ?? 'note';

  const doc = await ctx.documents.create({
    source,
    title: type,
    rawText: input.content,
    cleanText: input.content,
    contentHash,
    type,
    status: 'parsed',
    metadata: input.metadata
      ? (input.metadata as Prisma.InputJsonValue)
      : (Prisma.JsonNull as unknown as Prisma.InputJsonValue),
  });

  if (input.projects && input.projects.length > 0) {
    const resolved = await Promise.all(input.projects.map((slug) => ctx.projects.findBySlug(slug)));
    const projectIds = resolved
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => p.id);
    if (projectIds.length > 0) await ctx.documents.setProjects(doc.id, projectIds);
  }

  return { documentId: doc.id };
}
