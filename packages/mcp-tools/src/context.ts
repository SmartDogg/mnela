import type {
  AuditLogRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  Principal,
} from '@mnela/db';
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

export interface McpToolContext {
  documents: Pick<DocumentRepository, 'findById' | 'getChunks'>;
  entities: Pick<EntityRepository, 'findById' | 'findByNormalized' | 'create'>;
  edges: Pick<EdgeRepository, 'create'>;
  documentEntities: Pick<DocumentEntityRepository, 'upsert'>;
  inbox: Pick<InboxRepository, 'create'>;
  search: SimilarSearcher;
  events: EventSink;
  audit: Pick<AuditLogRepository, 'create'>;
  auditTx: AuditTxRunner;
  principal: Principal;
}
