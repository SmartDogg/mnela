import type { Edge, Entity } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type EdgeOutFull,
  type EntityOutFull,
  type GetEntityInput,
  GetEntityInputSchema,
  type GetEntityOutput,
  GetEntityOutputSchema,
} from '../schemas.js';

export const GET_ENTITY_TOOL = {
  name: 'mnela_get_entity',
  description: 'Look up an entity by name (and optional type) with adjacent documents and edges.',
  scope: 'read_only' as const,
  inputSchema: GetEntityInputSchema,
  outputSchema: GetEntityOutputSchema,
};

export function serializeEntity(e: Entity): EntityOutFull {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    aliases: e.aliases,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeEdge(edge: Edge): EdgeOutFull {
  return {
    id: edge.id,
    fromId: edge.fromId,
    toId: edge.toId,
    relationType: edge.relationType,
    confidence: edge.confidence,
    status: edge.status,
    evidenceDocumentId: edge.evidenceDocumentId,
    createdAt: edge.createdAt.toISOString(),
  };
}

export async function getEntity(
  input: GetEntityInput,
  ctx: McpToolContext,
): Promise<GetEntityOutput> {
  const result = await ctx.entities.findByNameWithJoins(input.name, input.type);
  if (!result) return null;
  return {
    entity: serializeEntity(result.entity),
    documents: result.documents.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      createdAt: d.createdAt.toISOString(),
    })),
    edges: result.edges.map(serializeEdge),
  };
}
