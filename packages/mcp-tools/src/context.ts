import type {
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
} from '@mnela/db';

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

export interface McpToolContext {
  documents: Pick<DocumentRepository, 'findById' | 'getChunks'>;
  entities: Pick<EntityRepository, 'findById' | 'findByNormalized' | 'create'>;
  edges: Pick<EdgeRepository, 'create'>;
  documentEntities: Pick<DocumentEntityRepository, 'upsert'>;
  inbox: Pick<InboxRepository, 'create'>;
  search: SimilarSearcher;
  events: EventSink;
}
