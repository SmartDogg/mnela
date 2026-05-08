import type { McpToolContext } from '../context.js';
import { McpInputError } from '../errors.js';
import {
  type SaveDecisionInput,
  SaveDecisionInputSchema,
  type SaveDecisionOutput,
  SaveDecisionOutputSchema,
} from '../schemas.js';

export const SAVE_DECISION_TOOL = {
  name: 'mnela_save_decision',
  description: 'Record a project decision. Resolves projectSlug → projectId.',
  scope: 'mcp' as const,
  inputSchema: SaveDecisionInputSchema,
  outputSchema: SaveDecisionOutputSchema,
  audit: {
    action: 'mcp.save_decision',
    targetType: 'Decision',
    targetIdFrom: 'output' as const,
    targetIdPath: 'decisionId',
  },
};

export async function saveDecision(
  input: SaveDecisionInput,
  ctx: McpToolContext,
): Promise<SaveDecisionOutput> {
  const project = await ctx.projects.findBySlug(input.projectSlug);
  if (!project) {
    throw new McpInputError(SAVE_DECISION_TOOL.name, `project not found: ${input.projectSlug}`);
  }

  const decision = await ctx.decisions.create({
    projectId: project.id,
    title: input.title,
    decision: input.decision,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.consequences !== undefined ? { consequences: input.consequences } : {}),
    ...(input.sourceDocumentId !== undefined ? { sourceDocumentId: input.sourceDocumentId } : {}),
  });
  return { decisionId: decision.id };
}
