import type { Document } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type DailyNoteOut,
  type GetDailyNoteInput,
  GetDailyNoteInputSchema,
  type GetDailyNoteOutput,
  GetDailyNoteOutputSchema,
} from '../schemas.js';

export const GET_DAILY_NOTE_TOOL = {
  name: 'mnela_get_daily_note',
  description: 'Fetch the daily note for a specific YYYY-MM-DD date.',
  scope: 'read_only' as const,
  inputSchema: GetDailyNoteInputSchema,
  outputSchema: GetDailyNoteOutputSchema,
};

/**
 * After ADR-0050 daily notes are stored as Document(source='daily') —
 * the sourceId holds the YYYY-MM-DD key. Mood lives in metadata so we
 * pull it from there for the legacy MCP output shape.
 */
export function serializeDailyDocument(doc: Document): DailyNoteOut {
  const metadata = (doc.metadata ?? {}) as { date?: string; mood?: string | null };
  return {
    id: doc.id,
    date: metadata.date ?? doc.sourceId ?? doc.createdAt.toISOString().slice(0, 10),
    contentMd: doc.rawText,
    mood: metadata.mood ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function getDailyNote(
  input: GetDailyNoteInput,
  ctx: McpToolContext,
): Promise<GetDailyNoteOutput> {
  const doc = await ctx.documents.findDailyByDate(input.date);
  return doc ? serializeDailyDocument(doc) : null;
}
