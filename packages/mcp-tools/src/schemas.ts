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

// =====================================================================
// Phase 6 read tools
// =====================================================================

const SOURCE_TYPES = [
  'chatgpt_export',
  'claude_export',
  'obsidian_vault',
  'manual_upload',
  'api_ingest',
  'telegram',
  'voice_note',
  'email',
  'web_clip',
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);

export const SearchFiltersSchema = z.object({
  projects: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  sources: z.array(SourceTypeSchema).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  languages: z.array(z.string()).optional(),
});

export const SearchInputSchema = z.object({
  query: z.string(),
  filters: SearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

const SearchHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  score: z.number(),
});
export const SearchOutputSchema = z.object({
  documents: z.array(SearchHitSchema),
  totalCount: z.number().int(),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

export const GetChunksInputSchema = z.object({
  documentId: z.string().min(1),
});
export type GetChunksInput = z.infer<typeof GetChunksInputSchema>;

export const GetChunksOutputSchema = z.object({
  chunks: z.array(DocumentChunkOutputSchema),
});
export type GetChunksOutput = z.infer<typeof GetChunksOutputSchema>;

export const ProjectOutSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  contextMd: z.string().nullable(),
  createdAt: z.string(),
});
export type ProjectOut = z.infer<typeof ProjectOutSchema>;

export const ListProjectsInputSchema = z.object({}).strict();
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

export const ListProjectsOutputSchema = z.object({
  projects: z.array(ProjectOutSchema),
});
export type ListProjectsOutput = z.infer<typeof ListProjectsOutputSchema>;

export const GetProjectContextInputSchema = z.object({
  slug: z.string().min(1),
});
export type GetProjectContextInput = z.infer<typeof GetProjectContextInputSchema>;

const DocumentSummaryOutSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string().nullable(),
  createdAt: z.string(),
});

export const DecisionOutSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  decision: z.string(),
  context: z.string().nullable(),
  consequences: z.string().nullable(),
  status: z.string(),
  sourceDocumentId: z.string().nullable(),
  decidedAt: z.string(),
  createdAt: z.string(),
});
export type DecisionOut = z.infer<typeof DecisionOutSchema>;

export const EntityOutFullSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: EntityTypeSchema,
  description: z.string().nullable(),
  aliases: z.array(z.string()),
  createdAt: z.string(),
});
export type EntityOutFull = z.infer<typeof EntityOutFullSchema>;

export const GetProjectContextOutputSchema = z.object({
  project: ProjectOutSchema,
  recentDocuments: z.array(DocumentSummaryOutSchema),
  decisions: z.array(DecisionOutSchema),
  entities: z.array(EntityOutFullSchema),
  openQuestions: z.array(z.string()),
});
export type GetProjectContextOutput = z.infer<typeof GetProjectContextOutputSchema>;

export const GetDecisionsInputSchema = z.object({
  projectSlug: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type GetDecisionsInput = z.infer<typeof GetDecisionsInputSchema>;

export const GetDecisionsOutputSchema = z.object({
  decisions: z.array(DecisionOutSchema),
});
export type GetDecisionsOutput = z.infer<typeof GetDecisionsOutputSchema>;

export const GetEntityInputSchema = z.object({
  name: z.string().min(1),
  type: EntityTypeSchema.optional(),
});
export type GetEntityInput = z.infer<typeof GetEntityInputSchema>;

export const EdgeOutFullSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  relationType: z.string(),
  confidence: z.number(),
  status: z.string(),
  evidenceDocumentId: z.string().nullable(),
  createdAt: z.string(),
});
export type EdgeOutFull = z.infer<typeof EdgeOutFullSchema>;

export const GetEntityOutputSchema = z
  .object({
    entity: EntityOutFullSchema,
    documents: z.array(DocumentSummaryOutSchema),
    edges: z.array(EdgeOutFullSchema),
  })
  .nullable();
export type GetEntityOutput = z.infer<typeof GetEntityOutputSchema>;

export const TraverseGraphInputSchema = z.object({
  fromEntity: z.string().min(1),
  maxDepth: z.number().int().min(1).max(5).optional(),
  relationTypes: z.array(z.string()).optional(),
});
export type TraverseGraphInput = z.infer<typeof TraverseGraphInputSchema>;

export const TraverseGraphOutputSchema = z.object({
  nodes: z.array(EntityOutFullSchema),
  edges: z.array(EdgeOutFullSchema),
});
export type TraverseGraphOutput = z.infer<typeof TraverseGraphOutputSchema>;

export const GetDailyNoteInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date YYYY-MM-DD'),
});
export type GetDailyNoteInput = z.infer<typeof GetDailyNoteInputSchema>;

export const DailyNoteOutSchema = z.object({
  id: z.string(),
  date: z.string(),
  contentMd: z.string(),
  mood: z.string().nullable(),
  createdAt: z.string(),
});
export type DailyNoteOut = z.infer<typeof DailyNoteOutSchema>;

export const GetDailyNoteOutputSchema = DailyNoteOutSchema.nullable();
export type GetDailyNoteOutput = z.infer<typeof GetDailyNoteOutputSchema>;

export const RecentActivityInputSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});
export type RecentActivityInput = z.infer<typeof RecentActivityInputSchema>;

export const RecentActivityOutputSchema = z.object({
  documents: z.array(DocumentSummaryOutSchema),
  decisions: z.array(DecisionOutSchema),
  notes: z.array(DailyNoteOutSchema),
});
export type RecentActivityOutput = z.infer<typeof RecentActivityOutputSchema>;

// =====================================================================
// Phase 6 write tools
// =====================================================================

export const SaveNoteInputSchema = z.object({
  content: z.string().min(1),
  type: z.string().optional(),
  source: SourceTypeSchema.optional(),
  projects: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SaveNoteInput = z.infer<typeof SaveNoteInputSchema>;

export const SaveNoteOutputSchema = z.object({
  documentId: z.string(),
});
export type SaveNoteOutput = z.infer<typeof SaveNoteOutputSchema>;

export const SaveDecisionInputSchema = z.object({
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  decision: z.string().min(1),
  context: z.string().optional(),
  consequences: z.string().optional(),
  sourceDocumentId: z.string().optional(),
});
export type SaveDecisionInput = z.infer<typeof SaveDecisionInputSchema>;

export const SaveDecisionOutputSchema = z.object({
  decisionId: z.string(),
});
export type SaveDecisionOutput = z.infer<typeof SaveDecisionOutputSchema>;

export const UpdateProjectContextInputSchema = z.object({
  slug: z.string().min(1),
  contextMd: z.string(),
});
export type UpdateProjectContextInput = z.infer<typeof UpdateProjectContextInputSchema>;

export const UpdateProjectContextOutputSchema = z.object({
  project: ProjectOutSchema,
});
export type UpdateProjectContextOutput = z.infer<typeof UpdateProjectContextOutputSchema>;

export const ArchiveDocumentInputSchema = z.object({
  id: z.string().min(1),
});
export type ArchiveDocumentInput = z.infer<typeof ArchiveDocumentInputSchema>;

export const ArchiveDocumentOutputSchema = z.object({
  ok: z.literal(true),
});
export type ArchiveDocumentOutput = z.infer<typeof ArchiveDocumentOutputSchema>;

// =====================================================================
// Phase 6 admin tools
// =====================================================================

export const TriggerEnrichmentInputSchema = z.object({
  documentId: z.string().min(1),
});
export type TriggerEnrichmentInput = z.infer<typeof TriggerEnrichmentInputSchema>;

export const TriggerEnrichmentOutputSchema = z.object({
  jobId: z.string(),
});
export type TriggerEnrichmentOutput = z.infer<typeof TriggerEnrichmentOutputSchema>;

export const RebuildIndexInputSchema = z.object({}).strict();
export type RebuildIndexInput = z.infer<typeof RebuildIndexInputSchema>;

export const RebuildIndexOutputSchema = z.object({
  jobId: z.string(),
});
export type RebuildIndexOutput = z.infer<typeof RebuildIndexOutputSchema>;

export const ExportVaultInputSchema = z.object({
  destinationPath: z.string().optional(),
});
export type ExportVaultInput = z.infer<typeof ExportVaultInputSchema>;

export const ExportVaultOutputSchema = z.object({
  exportPath: z.string(),
});
export type ExportVaultOutput = z.infer<typeof ExportVaultOutputSchema>;
