import type { Entity } from '@prisma/client';

import type { McpToolContext } from '../context.js';
import {
  type TraverseGraphInput,
  TraverseGraphInputSchema,
  type TraverseGraphOutput,
  TraverseGraphOutputSchema,
} from '../schemas.js';
import { serializeEdge, serializeEntity } from './get-entity.js';

const DEFAULT_DEPTH = 1;
const MAX_NODES = 200;

export const TRAVERSE_GRAPH_TOOL = {
  name: 'mnela_traverse_graph',
  description:
    'BFS the entity graph from a starting entity name out to maxDepth hops. Filters edges by relationTypes when provided.',
  scope: 'read_only' as const,
  inputSchema: TraverseGraphInputSchema,
  outputSchema: TraverseGraphOutputSchema,
};

export async function traverseGraph(
  input: TraverseGraphInput,
  ctx: McpToolContext,
): Promise<TraverseGraphOutput> {
  const start = await ctx.entities.findByNameWithJoins(input.fromEntity);
  if (!start) return { nodes: [], edges: [] };

  const depth = input.maxDepth ?? DEFAULT_DEPTH;
  const { nodeIds, edges } = await ctx.edges.neighborhood(start.entity.id, depth, MAX_NODES);

  const allowed = input.relationTypes;
  const filtered =
    allowed && allowed.length > 0 ? edges.filter((e) => allowed.includes(e.relationType)) : edges;

  const nodeArray = await Promise.all(Array.from(nodeIds).map((id) => ctx.entities.findById(id)));
  const nodes: Entity[] = nodeArray.filter((n): n is Entity => n !== null);

  return {
    nodes: nodes.map(serializeEntity),
    edges: filtered.map(serializeEdge),
  };
}
