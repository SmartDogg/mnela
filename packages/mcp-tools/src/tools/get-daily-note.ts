import type { DailyNote } from '@prisma/client';

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

export function serializeDailyNote(n: DailyNote): DailyNoteOut {
  return {
    id: n.id,
    date: n.date.toISOString().slice(0, 10),
    contentMd: n.contentMd,
    mood: n.mood,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function getDailyNote(
  input: GetDailyNoteInput,
  ctx: McpToolContext,
): Promise<GetDailyNoteOutput> {
  // Date col is stored as @db.Date; constructing a UTC midnight date matches the unique key.
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const note = await ctx.daily.findByDate(date);
  return note ? serializeDailyNote(note) : null;
}
