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

export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  source: SourceType;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  contentPreview?: string;
  projectSlugs?: string[];
}

export interface DocumentDetail extends DocumentSummary {
  contentMd: string;
  rawText: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  byteSize: number | null;
  fetchedAt: string | null;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  ord: number;
  content: string;
  tokenCount: number;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  description?: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  contextMd: string | null;
  documentCount: number;
  decisionCount: number;
}

export type DecisionStatus = 'open' | 'in_progress' | 'decided' | 'reverted';

export interface DecisionSummary {
  id: string;
  title: string;
  status: DecisionStatus;
  projectSlug: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionDetail extends DecisionSummary {
  contextMd: string;
  decisionMd: string;
  consequencesMd: string;
}

export interface DailyNote {
  date: string;
  contentMd: string;
  mood: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type JobType = 'ingest_file' | 'enrich_document' | 'index_chunks' | 'maintenance';

export interface JobSummary {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  progress: number;
  total: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
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

export interface SearchHit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  source: SourceType;
  type: DocumentType;
  matchedTerms: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  page: number;
  limit: number;
  total: number;
  mode: 'fts' | 'fuzzy' | 'hybrid';
  durationMs: number;
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

export interface PrincipalAdmin {
  kind: 'admin';
  adminUserId: string;
  username: string;
  scope: 'admin';
}

export interface PrincipalToken {
  kind: 'token';
  tokenId: string;
  name: string;
  scope: TokenScope;
}

export type Principal = PrincipalAdmin | PrincipalToken;

export interface SystemStats {
  documents: number;
  entities: number;
  edges: number;
  projects: number;
  decisions: number;
  dbSizeBytes: number;
}

export interface SystemConfigEntry {
  key: string;
  value: string;
  updatedAt: string;
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
