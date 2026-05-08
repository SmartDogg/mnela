import { normalizeEntityName } from '@mnela/db';

import type { McpToolContext } from '../context.js';
import {
  type AddEntitiesInput,
  AddEntitiesInputSchema,
  type AddEntitiesOutput,
  AddEntitiesOutputSchema,
} from '../schemas.js';

const MIN_CONFIDENCE = 0.5;

export const ADD_ENTITIES_TOOL = {
  name: 'mnela_add_entities',
  description:
    'Upsert entities extracted from a document. Reuses existing entities by normalized name + type. Drops entries with confidence < 0.5.',
  scope: 'mcp' as const,
  inputSchema: AddEntitiesInputSchema,
  outputSchema: AddEntitiesOutputSchema,
};

export async function addEntities(
  input: AddEntitiesInput,
  ctx: McpToolContext,
): Promise<AddEntitiesOutput> {
  const added: AddEntitiesOutput['added'] = [];
  const merged: AddEntitiesOutput['merged'] = [];
  let dropped = 0;

  for (const entry of input.entities) {
    if (entry.confidence < MIN_CONFIDENCE) {
      dropped += 1;
      continue;
    }
    const normalizedName = normalizeEntityName(entry.name);

    const existing = await ctx.entities.findByNormalized(normalizedName, entry.type);
    if (existing) {
      await ctx.documentEntities.upsert(input.documentId, existing.id, 1);
      merged.push({ id: existing.id, name: existing.name, type: existing.type });
      continue;
    }

    const create: Parameters<McpToolContext['entities']['create']>[0] = {
      name: entry.name,
      normalizedName,
      type: entry.type,
    };
    if (entry.aliases && entry.aliases.length > 0) create.aliases = entry.aliases;
    if (entry.description) create.description = entry.description;
    const created = await ctx.entities.create(create);
    await ctx.documentEntities.upsert(input.documentId, created.id, 1);
    await ctx.events.graphNodeAdded({
      id: created.id,
      name: created.name,
      type: created.type,
    });
    added.push({ id: created.id, name: created.name, type: created.type });
  }

  return { added, merged, dropped };
}
