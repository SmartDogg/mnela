import { normalizeEntityName } from '@mnela/db';

import type { McpToolContext } from '../context.js';
import {
  type SetAttachmentAnalysisInput,
  SetAttachmentAnalysisInputSchema,
  type SetAttachmentAnalysisOutput,
  SetAttachmentAnalysisOutputSchema,
} from '../schemas.js';

const MIN_CONFIDENCE = 0.5;

export const SET_ATTACHMENT_ANALYSIS_TOOL = {
  name: 'mnela_set_attachment_analysis',
  description:
    'Write vision-analysis results back for an image Attachment: description, optional OCR text, and entities visible in the image. Entities below confidence 0.5 are dropped. Used by the analyze_attachment orchestrator pipeline.',
  scope: 'mcp' as const,
  inputSchema: SetAttachmentAnalysisInputSchema,
  outputSchema: SetAttachmentAnalysisOutputSchema,
  audit: {
    action: 'mcp.set_attachment_analysis',
    targetType: 'Attachment',
    targetIdFrom: 'input' as const,
    targetIdPath: 'attachmentId',
  },
};

export async function setAttachmentAnalysis(
  input: SetAttachmentAnalysisInput,
  ctx: McpToolContext,
): Promise<SetAttachmentAnalysisOutput> {
  // 1) Look up the attachment + its companion image Document. The link was
  // stamped by the worker during persistAttachments (see ingestion.consumer
  // promoteImageToDocument).
  const attachment = await ctx.attachments.findById(input.attachmentId);
  if (!attachment) {
    throw new Error(`Attachment ${input.attachmentId} not found`);
  }

  // 2) Persist description + OCR. The repository sets analyzedAt for us.
  await ctx.attachments.setAnalysis(input.attachmentId, {
    description: input.description,
    ocrText: input.ocrText ?? null,
  });

  // 3) Write the description into the companion Document's rawText so the
  // text-based search + UI tabs have something to render. The image Document
  // starts at status='raw' with empty rawText; once analyzed we flip it to
  // 'enriched' since the description is the canonical "body" of an image.
  const linkedDocumentId = attachment.linkedDocumentId ?? null;
  if (linkedDocumentId) {
    await ctx.documents.update(linkedDocumentId, {
      rawText: input.description,
      cleanText: input.description,
      status: 'enriched',
    });
  }

  // 4) Upsert extracted entities + link them to the image Document so the
  // graph view connects images to people/places/things. Shape mirrors
  // mnela_add_entities so we reuse the same MIN_CONFIDENCE = 0.5 gate.
  let addedEntities = 0;
  let mergedEntities = 0;
  let droppedLowConfidence = 0;
  for (const entry of input.entities ?? []) {
    if (entry.confidence < MIN_CONFIDENCE) {
      droppedLowConfidence += 1;
      continue;
    }
    if (!linkedDocumentId) continue; // No image Document to attach entities to.
    const normalizedName = normalizeEntityName(entry.name);
    const existing = await ctx.entities.findByNormalized(normalizedName, entry.type);
    if (existing) {
      await ctx.documentEntities.upsert(linkedDocumentId, existing.id, 1);
      mergedEntities += 1;
      continue;
    }
    const create: Parameters<McpToolContext['entities']['create']>[0] = {
      name: entry.name,
      normalizedName,
      type: entry.type,
    };
    if (entry.aliases && entry.aliases.length > 0) create.aliases = entry.aliases;
    const created = await ctx.entities.create(create);
    await ctx.documentEntities.upsert(linkedDocumentId, created.id, 1);
    await ctx.events.graphNodeAdded({ id: created.id, name: created.name, type: created.type });
    addedEntities += 1;
  }

  return {
    attachmentId: input.attachmentId,
    linkedDocumentId,
    addedEntities,
    mergedEntities,
    droppedLowConfidence,
  };
}
