import { normalizeEntityName } from '@mnela/db';

import type { McpToolContext } from '../context.js';
import {
  type AddLinksInput,
  AddLinksInputSchema,
  type AddLinksOutput,
  AddLinksOutputSchema,
} from '../schemas.js';

const AUTO_CONFIRM_MIN = 0.8;
const REVIEW_MIN = 0.5;

export const ADD_LINKS_TOOL = {
  name: 'mnela_add_links',
  description:
    'Create edges between entities. Confidence routing: >0.8 auto-confirmed; 0.5–0.8 → needs_review + Inbox; <0.5 dropped.',
  scope: 'mcp' as const,
  inputSchema: AddLinksInputSchema,
  outputSchema: AddLinksOutputSchema,
};

export async function addLinks(input: AddLinksInput, ctx: McpToolContext): Promise<AddLinksOutput> {
  const added: AddLinksOutput['added'] = [];
  const queuedForReview: AddLinksOutput['queuedForReview'] = [];
  const missingEntities: AddLinksOutput['missingEntities'] = [];
  let dropped = 0;

  for (const link of input.links) {
    if (link.confidence < REVIEW_MIN) {
      dropped += 1;
      continue;
    }

    const fromNorm = normalizeEntityName(link.fromEntity.name);
    const toNorm = normalizeEntityName(link.toEntity.name);
    const fromEntity = await ctx.entities.findByNormalized(fromNorm, link.fromEntity.type);
    const toEntity = await ctx.entities.findByNormalized(toNorm, link.toEntity.type);

    if (!fromEntity || !toEntity) {
      missingEntities.push({
        from: link.fromEntity.name,
        to: link.toEntity.name,
        relationType: link.relationType,
      });
      continue;
    }

    const status = link.confidence > AUTO_CONFIRM_MIN ? 'auto_confirmed' : 'needs_review';
    const evidenceDocumentId = link.evidenceDocumentId ?? null;

    const edge = await ctx.edges.create({
      fromId: fromEntity.id,
      toId: toEntity.id,
      relationType: link.relationType,
      confidence: link.confidence,
      status,
      evidenceDocumentId,
    });

    await ctx.events.graphEdgeAdded({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      relationType: edge.relationType,
    });

    const out = {
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      relationType: edge.relationType,
      confidence: edge.confidence,
      status: edge.status,
    };

    if (status === 'auto_confirmed') {
      added.push(out);
    } else {
      queuedForReview.push(out);
      const title = `${fromEntity.name} → ${link.relationType} → ${toEntity.name}`;
      const item = await ctx.inbox.create({
        type: 'link_suggestion',
        title,
        description: `Confidence ${link.confidence.toFixed(2)}. Suggested by Claude enrichment.`,
        payload: {
          edgeId: edge.id,
          fromEntityId: fromEntity.id,
          toEntityId: toEntity.id,
          fromName: fromEntity.name,
          toName: toEntity.name,
          relationType: edge.relationType,
          confidence: link.confidence,
          evidenceDocumentId: evidenceDocumentId,
        },
        edgeId: edge.id,
        documentId: evidenceDocumentId,
      });
      await ctx.events.inboxItemAdded({
        itemId: item.id,
        itemType: item.type,
        title: item.title,
      });
    }
  }

  return { added, queuedForReview, dropped, missingEntities };
}
