import type {
  AttachmentRepository,
  AuditLogRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  Principal,
  ProjectRepository,
} from '@mnela/db';
import type { EnrichmentJob, IndexingJob } from '@mnela/queue';
import type { SearchFilters, SearchResult } from '@mnela/search';
import type { Prisma } from '@prisma/client';

export interface SimilarSearcher {
  findSimilar(
    text: string,
    limit: number,
  ): Promise<
    {
      documentId: string;
      title: string;
      snippet?: string;
      score: number;
    }[]
  >;
}

export interface FullSearcher {
  search(opts: {
    query: string;
    filters?: SearchFilters;
    page?: number;
    limit?: number;
  }): Promise<SearchResult>;
}

export interface EventSink {
  graphNodeAdded(node: { id: string; name: string; type: string }): void | Promise<void>;
  graphEdgeAdded(edge: {
    id: string;
    fromId: string;
    toId: string;
    relationType: string;
  }): void | Promise<void>;
  inboxItemAdded(item: { itemId: string; itemType: string; title: string }): void | Promise<void>;
}

export type AuditTxRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export interface QueueAddOptions {
  attempts?: number;
  backoff?: { type: string; delay: number };
}

export interface QueueAdder<T> {
  add(name: string, data: T, opts?: QueueAddOptions): Promise<{ id?: string }>;
}

export interface McpToolContext {
  documents: Pick<
    DocumentRepository,
    | 'findById'
    | 'getChunks'
    | 'list'
    | 'create'
    | 'update'
    | 'setProjects'
    | 'findByContentHash'
    | 'findDailyByDate'
    | 'listDaily'
  >;
  attachments: Pick<AttachmentRepository, 'findById' | 'setAnalysis' | 'listForDocument'>;
  entities: Pick<
    EntityRepository,
    'findById' | 'findByNormalized' | 'create' | 'findByNameWithJoins' | 'listTopForProject'
  >;
  edges: Pick<EdgeRepository, 'create' | 'neighborhood'>;
  documentEntities: Pick<DocumentEntityRepository, 'upsert'>;
  inbox: Pick<InboxRepository, 'create'>;
  projects: Pick<ProjectRepository, 'list' | 'findBySlug' | 'findByIds' | 'update'>;
  decisions: Pick<DecisionRepository, 'list' | 'create'>;
  jobs: Pick<JobRepository, 'create'>;
  search: SimilarSearcher & FullSearcher;
  events: EventSink;
  audit: Pick<AuditLogRepository, 'create'>;
  auditTx: AuditTxRunner;
  principal: Principal;
  enrichmentQueue: QueueAdder<EnrichmentJob>;
  indexingQueue: QueueAdder<IndexingJob>;
}
