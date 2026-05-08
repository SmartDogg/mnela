import type { McpToolContext } from '../context.js';
import {
  type RecentActivityInput,
  RecentActivityInputSchema,
  type RecentActivityOutput,
  RecentActivityOutputSchema,
} from '../schemas.js';
import { serializeDailyNote } from './get-daily-note.js';
import { serializeDecision } from './get-project-context.js';

const DEFAULT_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const RECENT_ACTIVITY_TOOL = {
  name: 'mnela_recent_activity',
  description: 'Recent documents, decisions, and daily notes within the last N days (default 7).',
  scope: 'read_only' as const,
  inputSchema: RecentActivityInputSchema,
  outputSchema: RecentActivityOutputSchema,
};

export async function recentActivity(
  input: RecentActivityInput,
  ctx: McpToolContext,
): Promise<RecentActivityOutput> {
  const days = input.days ?? DEFAULT_DAYS;
  const from = new Date(Date.now() - days * MS_PER_DAY);

  const [docsPage, decisionsPage, notes] = await Promise.all([
    ctx.documents.list({ dateFrom: from }, { page: 1, limit: 20 }),
    // DecisionListFilters has no date axis; pull the recent page and filter by decidedAt.
    ctx.decisions.list({}, { page: 1, limit: 50 }),
    ctx.daily.list(from, undefined),
  ]);

  return {
    documents: docsPage.items.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      createdAt: d.createdAt.toISOString(),
    })),
    decisions: decisionsPage.items.filter((d) => d.decidedAt >= from).map(serializeDecision),
    notes: notes.map(serializeDailyNote),
  };
}
