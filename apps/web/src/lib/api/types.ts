// Hand-rolled DTOs. Will be replaced by `pnpm codegen:api` (see ADR-0019)
// once the API is reachable; until then these mirror the controllers in
// apps/api/src/modules/*.

export type DocumentStatus = 'raw' | 'parsed' | 'enriching' | 'enriched' | 'failed' | 'archived';

export type SourceType =
  | 'chatgpt_export'
  | 'claude_export'
  | 'obsidian_vault'
  | 'manual_upload'
  | 'api_ingest'
  | 'telegram'
  | 'voice_note'
  | 'email'
  | 'web_clip';

export type DocumentType =
  | 'note'
  | 'conversation'
  | 'article'
  | 'document'
  | 'transcript'
  | 'image'
  | 'audio'
  | 'synthesis';

// The API returns `{ items, total, page, limit }` (packages/db pagination contract).
// Earlier the web mis-typed this as `data` — every list page crashed at `.data.data.map`.
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  type: DocumentType | null;
  status: DocumentStatus;
  source: SourceType;
  sourceId?: string | null;
  language: string | null;
  tokenCount?: number | null;
  createdAt: string;
  updatedAt: string;
  ingestedAt: string;
  enrichedAt: string | null;
  archivedAt: string | null;
}

// Mirrors what /documents/:id returns — full Document row from Prisma. Earlier
// the web type invented contentMd/byteSize/fetchedAt/projectSlugs that the API
// never emits. Use `cleanText ?? rawText` when you want a single editable body.
export interface DocumentDetail extends DocumentSummary {
  rawText: string;
  cleanText: string | null;
  metadata: Record<string, unknown> | null;
  contentHash: string;
  vaultPath: string | null;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  ord: number;
  content: string;
  tokenCount: number;
}

export type ProjectStatus = 'active' | 'archived' | 'paused';

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

// API /projects/:slug returns the bare Project row — no derived counts.
// Components needing documentCount / decisionCount should issue separate
// queries (e.g. /documents?projectSlug=foo&limit=1 and read `.total`).
export interface ProjectDetail extends ProjectSummary {
  contextMd: string | null;
  metadata: Record<string, unknown> | null;
}

export type DecisionStatus = 'active' | 'superseded' | 'reverted';

export interface DecisionSummary {
  id: string;
  projectId: string | null;
  title: string;
  status: DecisionStatus;
  decidedAt: string;
  createdAt: string;
}

// Mirrors the Decision Prisma row — fields are decision/context/consequences
// (not *Md). Drop the `updatedAt` invention.
export interface DecisionDetail extends DecisionSummary {
  decision: string;
  context: string | null;
  consequences: string | null;
  supersededById: string | null;
  sourceDocumentId: string | null;
}

// ADR-0050: DailyNote was merged into Document(source='daily'). The
// /ask Daily sidebar queries `/search/pinned-by-day` and renders
// Document rows grouped by metadata.date / createdAt.

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type JobType = 'ingest_file' | 'enrich_document' | 'index_chunks' | 'maintenance';

// Mirrors what GET /jobs/:id and /jobs return. Earlier the web invented
// progress/total/updatedAt fields that the API never emits — DB Job rows
// don't carry BullMQ progress (live UI gets that via Socket.io job.progress
// events) and there is no updatedAt column. Pick a sensible "last activity"
// timestamp via the helper exported below.
export interface JobSummary {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  documentId: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  costEstimate: number | null;
}

export function jobLastActivityAt(
  job: Pick<JobSummary, 'createdAt' | 'startedAt' | 'completedAt'>,
): string {
  return job.completedAt ?? job.startedAt ?? job.createdAt;
}

export interface JobStats {
  queued: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface JobThroughputBucket {
  ts: string;
  count: number;
}

export interface JobThroughputStats {
  buckets: JobThroughputBucket[];
}

export interface JobDurationStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  total: number;
}

export interface JobErrorRateStats {
  totalCompleted: number;
  totalFailed: number;
  rate: number;
}

/**
 * Live enrichment-queue snapshot. Initial load from GET /jobs/queue-state;
 * live patches arrive via the `enrichment.queue.tick` Socket.io event.
 * Mirrors packages/queue/src/enrichment-stats.ts `EnrichmentSnapshot`.
 */
export interface EnrichmentQueueState {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completedLastHour: number;
  ratePerMinute: number;
  p50DurationMs: number;
  parallelism: number;
  useSlot: boolean;
  slotHolder: 'ask' | 'enrichment' | null;
  paused: boolean;
  userPaused: boolean;
  rateLimitedUntil: string | null;
}

// Mirrors @mnela/search SearchHit — the API only returns documentId/title/
// snippet/score plus the FTS / trigram intermediates. Source/type/matchedTerms
// are not emitted; resolve them via /documents/:id when needed.
export interface SearchHit {
  documentId: string;
  title: string;
  snippet?: string;
  score: number;
  ftsRank?: number;
  trigramSimilarity?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  page: number;
  limit: number;
  total: number;
  mode: 'fts' | 'fuzzy' | 'hybrid';
}

export type SearchMode = 'fts' | 'fuzzy' | 'hybrid';

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  filters?: {
    status?: DocumentStatus;
    source?: SourceType;
    type?: string;
    projectSlug?: string;
  };
  page?: number;
  limit?: number;
}

export type TokenScope = 'admin' | 'mcp' | 'read_only';

export interface AuthTokenSummary {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface CreatedAuthToken extends AuthTokenSummary {
  token: string;
}

// Mirrors the API's canonical Principal (packages/db/src/auth.ts:13). Earlier
// versions hand-rolled adminUserId/username/tokenId fields that the API does
// not return — keep this in sync with what /api/v1/auth/me actually emits.
export interface Principal {
  kind: 'admin' | 'token';
  id: string;
  scope: TokenScope;
  name?: string;
}

export interface SystemStats {
  documents: number;
  entities: number;
  edges: number;
  projects: number;
  decisions: number;
  inboxPending: number;
  jobsQueued: number;
  dbSizeBytes: number;
}

// Legacy shape (kept for any prior consumers). New code should use
// `MergedConfigEntry` returned by GET /system/config — see below.
export interface SystemConfigEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Merged entry returned by GET /system/config — spec metadata from the
 * server-side registry plus the resolved value (override-or-default). The
 * admin UI uses `spec.type` to pick a control and `spec.group` to bucket
 * rows; `overridden` flips the badge + reset button.
 */
export type ConfigType = 'bytes' | 'int' | 'bool' | 'enum' | 'string';
export type ConfigGroup =
  | 'imports'
  | 'parsers'
  | 'enrichment'
  | 'vision'
  | 'whisper'
  | 'claude'
  | 'worker'
  | 'providers';

export type ConfigSection = 'providers' | 'ingestion' | 'enrichment' | 'storage' | 'advanced';

interface ConfigSpecCommon {
  key: string;
  group: ConfigGroup;
  section?: ConfigSection;
  description: string;
  requiresRestart?: boolean;
}

export type ConfigSpec =
  | (ConfigSpecCommon & {
      type: 'bytes';
      default: number;
      min?: number;
      max?: number | null;
      presets?: number[];
    })
  | (ConfigSpecCommon & { type: 'int'; default: number; min?: number; max?: number })
  | (ConfigSpecCommon & { type: 'bool'; default: boolean })
  | (ConfigSpecCommon & { type: 'enum'; default: string; options: string[] })
  | (ConfigSpecCommon & { type: 'string'; default: string; pattern?: string });

export interface MergedConfigEntry {
  spec: ConfigSpec;
  value: unknown;
  overridden: boolean;
  updatedAt: string | null;
}

export type InboxItemType =
  | 'link_suggestion'
  | 'entity_merge_suggestion'
  | 'duplicate_detection'
  | 'enrichment_failed'
  | 'conflicting_decision';

export interface InboxSummary {
  id: string;
  type: InboxItemType;
  status: 'pending' | 'accepted' | 'rejected';
  title: string;
  description: string;
  createdAt: string;
  payload: Record<string, unknown>;
  documentId?: string | null;
  edgeId?: string | null;
  entityId?: string | null;
}

export interface LinkSuggestionPayload {
  edgeId?: string;
  fromEntityId?: string;
  toEntityId?: string;
  fromName: string;
  toName: string;
  relationType: string;
  confidence: number;
  evidenceDocumentId?: string | null;
}

export interface EntityMergeSuggestionPayload {
  sourceId: string;
  targetId: string;
  sourceName?: string;
  targetName?: string;
  sharedNeighbors?: number;
  sharedDocuments?: number;
}

export interface DuplicateDetectionPayload {
  documentIdA: string;
  documentIdB: string;
  titleA?: string;
  titleB?: string;
  contentHashMatch?: boolean;
  similarityScore?: number;
}

export interface EnrichmentFailedPayload {
  documentId: string;
  attempts?: number;
  lastError?: string;
}

export interface ConflictingDecisionPayload {
  decisionId: string;
  conflictingDecisionId: string;
  summary?: string;
}

export interface BulkInboxResult {
  batchId: string;
  accepted: { id: string }[];
  failed: { id: string; reason: string }[];
}

export type EntityType =
  | 'project'
  | 'person'
  | 'organization'
  | 'technology'
  | 'concept'
  | 'product'
  | 'service'
  | 'bug'
  | 'feature'
  | 'custom';

export type LinkStatus = 'auto_confirmed' | 'needs_review' | 'manual' | 'rejected';

export interface EntitySummary {
  id: string;
  name: string;
  normalizedName: string;
  type: EntityType;
  description: string | null;
  aliases: string[];
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeSummary {
  id: string;
  fromId: string;
  toId: string;
  relationType: string;
  confidence: number;
  status: LinkStatus;
  evidenceDocumentId: string | null;
  evidenceChunkId: string | null;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface MergeCounts {
  documentLinks: number;
  edgeRepoints: number;
  edgeDedupes: number;
  selfLoops: number;
}

export interface MergeEntitiesResult {
  dryRun: boolean;
  counts: MergeCounts;
  entity: EntitySummary | null;
}

export interface ClaudeStatus {
  available: boolean;
  reason?: 'no-binary' | 'not-logged-in' | 'rate-limit' | 'orchestrator-not-running';
  checkedAt: string;
  resetAt?: string;
  version?: string;
}

export interface ClaudeTestResult {
  ok: boolean;
  version?: string;
  error?: string;
  latencyMs: number;
}

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

// ---- LLM providers (ADR-0049) ----------------------------------------------

export type LlmProviderKind = 'claude_cli' | 'anthropic_api' | 'openai_compat';

export interface LlmProviderRow {
  id: string;
  name: string;
  kind: LlmProviderKind;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  apiKeyLast4: string | null;
  extra: Record<string, unknown> | null;
  builtin: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ProviderFeatureKey = 'default' | 'ask' | 'enrichment' | 'vision' | 'projectContext';

export interface ProvidersListResponse {
  providers: LlmProviderRow[];
  defaults: Record<ProviderFeatureKey, string>;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}
