import type { McpToolContext } from '../context.js';
import {
  type GetDecisionsInput,
  GetDecisionsInputSchema,
  type GetDecisionsOutput,
  GetDecisionsOutputSchema,
} from '../schemas.js';
import { serializeDecision } from './get-project-context.js';

const DEFAULT_LIMIT = 20;

export const GET_DECISIONS_TOOL = {
  name: 'mnela_get_decisions',
  description: 'List decisions, optionally filtered by project slug.',
  scope: 'read_only' as const,
  inputSchema: GetDecisionsInputSchema,
  outputSchema: GetDecisionsOutputSchema,
};

export async function getDecisions(
  input: GetDecisionsInput,
  ctx: McpToolContext,
): Promise<GetDecisionsOutput> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const filters = input.projectSlug ? { projectSlug: input.projectSlug } : {};
  const page = await ctx.decisions.list(filters, { page: 1, limit });
  return { decisions: page.items.map(serializeDecision) };
}
