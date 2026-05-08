import type { Principal, TokenScope } from '@mnela/db';
import type {
  AuditLog,
  Document,
  DocumentChunk,
  DocumentEntity,
  Edge,
  Entity,
  EntityType,
  InboxItem,
  Prisma,
} from '@prisma/client';
import { vi } from 'vitest';

import type { McpToolContext } from '../context.js';

export interface MockBag {
  ctx: McpToolContext;
  docs: Map<string, Document>;
  chunks: Map<string, DocumentChunk[]>;
  entities: Map<string, Entity>;
  entitiesByNorm: Map<string, Entity>;
  edges: Edge[];
  inboxItems: InboxItem[];
  events: (
    | { kind: 'graph.node_added'; entity: { id: string; name: string; type: string } }
    | {
        kind: 'graph.edge_added';
        edge: { id: string; fromId: string; toId: string; relationType: string };
      }
    | { kind: 'inbox.item_added'; item: { itemId: string; itemType: string; title: string } }
  )[];
  similar: { documentId: string; title: string; snippet?: string; score: number }[];
  auditRows: AuditLog[];
  auditTxCalls: number;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

function makeEntity(input: { name: string; normalizedName: string; type: EntityType }): Entity {
  return {
    id: nextId('ent'),
    name: input.name,
    normalizedName: input.normalizedName,
    type: input.type,
    description: null,
    aliases: [],
    metadata: null,
    mergedIntoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function buildMockCtx(
  seed: {
    entities?: Entity[];
    documents?: Document[];
    principalScope?: TokenScope;
    principalName?: string;
  } = {},
): MockBag {
  const docs = new Map<string, Document>();
  const chunks = new Map<string, DocumentChunk[]>();
  const entities = new Map<string, Entity>();
  const entitiesByNorm = new Map<string, Entity>();
  const edges: Edge[] = [];
  const inboxItems: InboxItem[] = [];
  const events: MockBag['events'] = [];
  const similar: MockBag['similar'] = [];
  const auditRows: AuditLog[] = [];
  let auditTxCalls = 0;

  for (const d of seed.documents ?? []) docs.set(d.id, d);
  for (const e of seed.entities ?? []) {
    entities.set(e.id, e);
    entitiesByNorm.set(`${e.normalizedName}|${e.type}`, e);
  }

  const ctx: McpToolContext = {
    documents: {
      findById: vi.fn(async (id: string) => docs.get(id) ?? null),
      getChunks: vi.fn(async (id: string) => chunks.get(id) ?? []),
    },
    entities: {
      findById: vi.fn(async (id: string) => entities.get(id) ?? null),
      findByNormalized: vi.fn(
        async (n: string, t: EntityType) => entitiesByNorm.get(`${n}|${t}`) ?? null,
      ),
      create: vi.fn(async (input) => {
        const e = makeEntity(input);
        entities.set(e.id, e);
        entitiesByNorm.set(`${e.normalizedName}|${e.type}`, e);
        return e;
      }),
    },
    edges: {
      create: vi.fn(async (input): Promise<Edge> => {
        const e: Edge = {
          id: nextId('edge'),
          fromId: input.fromId,
          toId: input.toId,
          relationType: input.relationType,
          confidence: input.confidence ?? 1,
          status: input.status ?? 'auto_confirmed',
          evidenceDocumentId: input.evidenceDocumentId ?? null,
          evidenceChunkId: input.evidenceChunkId ?? null,
          validFrom: new Date(),
          validUntil: null,
          invalidatedById: null,
          createdAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
        };
        edges.push(e);
        return e;
      }),
    },
    documentEntities: {
      upsert: vi.fn(
        async (documentId: string, entityId: string): Promise<DocumentEntity> => ({
          documentId,
          entityId,
          mentions: 1,
          context: null,
        }),
      ),
    },
    inbox: {
      create: vi.fn(async (input): Promise<InboxItem> => {
        const item: InboxItem = {
          id: nextId('inbox'),
          type: input.type,
          title: input.title,
          description: input.description,
          payload: input.payload,
          documentId: input.documentId ?? null,
          edgeId: input.edgeId ?? null,
          entityId: input.entityId ?? null,
          status: 'pending',
          resolvedAt: null,
          resolvedBy: null,
          createdAt: new Date(),
        };
        inboxItems.push(item);
        return item;
      }),
    },
    search: {
      findSimilar: vi.fn(async (_text: string, limit: number) => similar.slice(0, limit)),
    },
    events: {
      graphNodeAdded: vi.fn((entity) => {
        events.push({ kind: 'graph.node_added', entity });
      }),
      graphEdgeAdded: vi.fn((edge) => {
        events.push({ kind: 'graph.edge_added', edge });
      }),
      inboxItemAdded: vi.fn((item) => {
        events.push({ kind: 'inbox.item_added', item });
      }),
    },
    audit: {
      create: vi.fn(async (input): Promise<AuditLog> => {
        const row: AuditLog = {
          id: nextId('audit'),
          action: input.action,
          actor: input.actor,
          targetType: input.targetType,
          targetId: input.targetId,
          before: (input.before ?? null) as Prisma.JsonValue,
          after: (input.after ?? null) as Prisma.JsonValue,
          metadata: (input.metadata ?? null) as Prisma.JsonValue,
          createdAt: new Date(),
        };
        auditRows.push(row);
        return row;
      }),
    },
    auditTx: async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
      auditTxCalls += 1;
      return fn({} as Prisma.TransactionClient);
    },
    principal: makePrincipal(seed.principalScope ?? 'admin', seed.principalName ?? 'test-token'),
  };

  return {
    ctx,
    docs,
    chunks,
    entities,
    entitiesByNorm,
    edges,
    inboxItems,
    events,
    similar,
    auditRows,
    get auditTxCalls(): number {
      return auditTxCalls;
    },
  };
}

function makePrincipal(scope: TokenScope, name: string): Principal {
  return { kind: 'token', id: `tok_${name}`, name, scope };
}

export function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: nextId('doc'),
    source: 'manual_upload',
    sourceId: null,
    title: 'Untitled',
    rawText: 'hello world',
    cleanText: null,
    contentHash: 'h',
    tokenCount: 2,
    language: 'en',
    type: null,
    metadata: null,
    status: 'parsed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ingestedAt: new Date(),
    enrichedAt: null,
    archivedAt: null,
    vaultPath: null,
    ...overrides,
  };
}

export function seedEntity(name: string, type: EntityType): Entity {
  return makeEntity({ name, normalizedName: name.toLowerCase(), type });
}
