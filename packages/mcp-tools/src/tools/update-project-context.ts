import type { McpToolContext } from '../context.js';
import {
  type UpdateProjectContextInput,
  UpdateProjectContextInputSchema,
  type UpdateProjectContextOutput,
  UpdateProjectContextOutputSchema,
} from '../schemas.js';
import { serializeProject } from './list-projects.js';

export const UPDATE_PROJECT_CONTEXT_TOOL = {
  name: 'mnela_update_project_context',
  description: "Replace a project's contextMd (markdown) blob.",
  scope: 'mcp' as const,
  inputSchema: UpdateProjectContextInputSchema,
  outputSchema: UpdateProjectContextOutputSchema,
  audit: {
    action: 'mcp.update_project_context',
    targetType: 'Project',
    targetIdFrom: 'input' as const,
    targetIdPath: 'slug',
  },
};

export async function updateProjectContext(
  input: UpdateProjectContextInput,
  ctx: McpToolContext,
): Promise<UpdateProjectContextOutput> {
  const updated = await ctx.projects.update(input.slug, { contextMd: input.contextMd });
  return { project: serializeProject(updated) };
}
