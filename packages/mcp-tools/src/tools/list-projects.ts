import type { Project } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type ListProjectsInput,
  ListProjectsInputSchema,
  type ListProjectsOutput,
  ListProjectsOutputSchema,
  type ProjectOut,
} from '../schemas.js';

export const LIST_PROJECTS_TOOL = {
  name: 'mnela_list_projects',
  description: 'List all projects in the vault.',
  scope: 'read_only' as const,
  inputSchema: ListProjectsInputSchema,
  outputSchema: ListProjectsOutputSchema,
};

export function serializeProject(p: Project): ProjectOut {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    status: p.status,
    contextMd: p.contextMd,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listProjects(
  _input: ListProjectsInput,
  ctx: McpToolContext,
): Promise<ListProjectsOutput> {
  const page = await ctx.projects.list({ page: 1, limit: 100 });
  return { projects: page.items.map(serializeProject) };
}
