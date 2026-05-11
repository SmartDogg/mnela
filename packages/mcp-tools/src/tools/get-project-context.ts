import type { Decision, Document, Entity, Project } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type DecisionOut,
  type EntityOutFull,
  type GetProjectContextInput,
  GetProjectContextInputSchema,
  type GetProjectContextOutput,
  GetProjectContextOutputSchema,
} from '../schemas.js';
import { serializeProject } from './list-projects.js';

export const GET_PROJECT_CONTEXT_TOOL = {
  name: 'mnela_get_project_context',
  description: 'Fetch a project plus its recent documents, decisions, and open questions.',
  scope: 'read_only' as const,
  inputSchema: GetProjectContextInputSchema,
  outputSchema: GetProjectContextOutputSchema,
};

export function serializeDecision(d: Decision): DecisionOut {
  return {
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    decision: d.decision,
    context: d.context,
    consequences: d.consequences,
    status: d.status,
    sourceDocumentId: d.sourceDocumentId,
    decidedAt: d.decidedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

function summarizeDocument(d: Document): {
  id: string;
  title: string;
  type: string | null;
  createdAt: string;
} {
  return { id: d.id, title: d.title, type: d.type, createdAt: d.createdAt.toISOString() };
}

function serializeEntity(e: Entity): EntityOutFull {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    aliases: e.aliases,
    createdAt: e.createdAt.toISOString(),
  };
}

function extractOpenQuestions(project: Project): string[] {
  const meta = project.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const value = (meta as Record<string, unknown>)['openQuestions'];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export async function getProjectContext(
  input: GetProjectContextInput,
  ctx: McpToolContext,
): Promise<GetProjectContextOutput> {
  const project = await ctx.projects.findBySlug(input.slug);
  if (!project) throw new Error(`project not found: ${input.slug}`);

  const [docsPage, decisionsPage, topEntities] = await Promise.all([
    ctx.documents.list({ projectSlug: project.slug }, { page: 1, limit: 20 }),
    ctx.decisions.list({ projectSlug: project.slug }, { page: 1, limit: 50 }),
    ctx.entities.listTopForProject(project.slug, 50),
  ]);

  return {
    project: serializeProject(project),
    recentDocuments: docsPage.items.map(summarizeDocument),
    decisions: decisionsPage.items.map(serializeDecision),
    entities: topEntities.map(serializeEntity),
    openQuestions: extractOpenQuestions(project),
  };
}
