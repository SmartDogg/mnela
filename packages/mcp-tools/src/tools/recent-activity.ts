import type { McpToolContext } from '../context.js';
import {
  type RecentActivityInput,
  RecentActivityInputSchema,
  type RecentActivityOutput,
  RecentActivityOutputSchema,
} from '../schemas.js';
import { serializeDailyDocument } from './get-daily-note.js';
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
  // ADR-0050: daily notes are Document(source='daily'); query by the
  // ISO-date sourceId so naive lex-comparison matches a real time window.
  const fromDate = from.toISOString().slice(0, 10);

  const [docsPage, decisionsPage, dailyDocs] = await Promise.all([
    ctx.documents.list({ dateFrom: from }, { page: 1, limit: 20 }),
    // DecisionListFilters has no date axis; pull the recent page and filter by decidedAt.
    ctx.decisions.list({}, { page: 1, limit: 50 }),
    ctx.documents.listDaily(fromDate, undefined, 50),
  ]);

  return {
    documents: docsPage.items.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      createdAt: d.createdAt.toISOString(),
    })),
    decisions: decisionsPage.items.filter((d) => d.decidedAt >= from).map(serializeDecision),
    notes: dailyDocs.map(serializeDailyDocument),
  };
}
