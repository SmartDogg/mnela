import { z } from 'zod';

export const ENTITY_TYPES = [
  'project',
  'person',
  'organization',
  'technology',
  'concept',
  'product',
  'service',
  'bug',
  'feature',
  'custom',
] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);

const ConfidenceSchema = z.number().min(0).max(1);

export const GetDocumentInputSchema = z.object({
  id: z.string().min(1),
});
export type GetDocumentInput = z.infer<typeof GetDocumentInputSchema>;

export const DocumentChunkOutputSchema = z.object({
  id: z.string(),
  chunkIndex: z.number().int(),
  text: z.string(),
  tokenCount: z.number().int(),
});

export const GetDocumentOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  status: z.string(),
  language: z.string().nullable(),
  type: z.string().nullable(),
  rawText: z.string(),
  cleanText: z.string().nullable(),
  tokenCount: z.number().int().nullable(),
  createdAt: z.string(),
  chunks: z.array(DocumentChunkOutputSchema),
});
export type GetDocumentOutput = z.infer<typeof GetDocumentOutputSchema>;

export const FindSimilarInputSchema = z.object({
  text: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  excludeDocumentId: z.string().optional(),
});
export type FindSimilarInput = z.infer<typeof FindSimilarInputSchema>;

export const DocumentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  score: z.number(),
});
export const FindSimilarOutputSchema = z.object({
  documents: z.array(DocumentSummarySchema),
});
export type FindSimilarOutput = z.infer<typeof FindSimilarOutputSchema>;

export const AddEntitiesInputSchema = z.object({
  documentId: z.string().min(1),
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        type: EntityTypeSchema,
        aliases: z.array(z.string()).optional(),
        confidence: ConfidenceSchema,
        description: z.string().optional(),
      }),
    )
    .min(1),
});
export type AddEntitiesInput = z.infer<typeof AddEntitiesInputSchema>;

export const EntityOutSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: EntityTypeSchema,
});
export const AddEntitiesOutputSchema = z.object({
  added: z.array(EntityOutSchema),
  merged: z.array(EntityOutSchema),
  dropped: z.number().int(),
});
export type AddEntitiesOutput = z.infer<typeof AddEntitiesOutputSchema>;

export const AddLinksInputSchema = z.object({
  links: z
    .array(
      z.object({
        fromEntity: z.object({ name: z.string().min(1), type: EntityTypeSchema }),
        toEntity: z.object({ name: z.string().min(1), type: EntityTypeSchema }),
        relationType: z.string().min(1),
        confidence: ConfidenceSchema,
        evidenceDocumentId: z.string().optional(),
      }),
    )
    .min(1),
});
export type AddLinksInput = z.infer<typeof AddLinksInputSchema>;

export const EdgeOutSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  relationType: z.string(),
  confidence: z.number(),
  status: z.string(),
});
export const AddLinksOutputSchema = z.object({
  added: z.array(EdgeOutSchema),
  queuedForReview: z.array(EdgeOutSchema),
  dropped: z.number().int(),
  missingEntities: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      relationType: z.string(),
    }),
  ),
});
export type AddLinksOutput = z.infer<typeof AddLinksOutputSchema>;
