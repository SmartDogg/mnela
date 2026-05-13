import type { Principal, TokenScope } from '@mnela/db';
import type { EnrichmentJob, IndexingJob } from '@mnela/queue';
import type { SearchFilters, SearchResult } from '@mnela/search';
import type {
  AuditLog,
  Decision,
  Document,
  DocumentChunk,
  DocumentEntity,
  Edge,
  Entity,
  EntityType,
  InboxItem,
  Job,
  Prisma,
  Project,
  SourceType,
} from '@prisma/client';
import { vi } from 'vitest';

import type { McpToolContext, QueueAddOptions } from '../context.js';

export interface QueuedJobRecord<T> {
  name: string;
  data: T;
  opts?: QueueAddOptions;
}

export interface MockBag {
  ctx: McpToolContext;
  docs: Map<string, Document>;
  chunks: Map<string, DocumentChunk[]>;
  entities: Map<string, Entity>;
  entitiesByNorm: Map<string, Entity>;
  edges: Edge[];
  inboxItems: InboxItem[];
  projects: Map<string, Project>;
  decisions: Decision[];
  /** Daily notes — represented as Document(source='daily') after ADR-0050. */
  dailyDocs: Document[];
  jobsCreated: Job[];
  enrichmentJobsAdded: QueuedJobRecord<EnrichmentJob>[];
  indexingJobsAdded: QueuedJobRecord<IndexingJob>[];
  searchResults: SearchResult;
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
    projects?: Project[];
    decisions?: Decision[];
    /** Daily notes are Document(source='daily') after ADR-0050. */
    dailyDocs?: Document[];
    edges?: Edge[];
    principalScope?: TokenScope;
    principalName?: string;
    searchResults?: SearchResult;
  } = {},
): MockBag {
  const docs = new Map<string, Document>();
  const chunks = new Map<string, DocumentChunk[]>();
  const entities = new Map<string, Entity>();
  const entitiesByNorm = new Map<string, Entity>();
  const edges: Edge[] = [];
  const inboxItems: InboxItem[] = [];
  const projects = new Map<string, Project>();
  const decisions: Decision[] = [];
  const dailyDocs: Document[] = [];
  const jobsCreated: Job[] = [];
  const enrichmentJobsAdded: QueuedJobRecord<EnrichmentJob>[] = [];
  const indexingJobsAdded: QueuedJobRecord<IndexingJob>[] = [];
  const events: MockBag['events'] = [];
  const similar: MockBag['similar'] = [];
  const auditRows: AuditLog[] = [];
  let auditTxCalls = 0;

  let searchResults: SearchResult = seed.searchResults ?? {
    mode: 'fts',
    hits: [],
    total: 0,
    page: 1,
    limit: 20,
  };

  for (const d of seed.documents ?? []) docs.set(d.id, d);
  for (const e of seed.entities ?? []) {
    entities.set(e.id, e);
    entitiesByNorm.set(`${e.normalizedName}|${e.type}`, e);
  }
  for (const p of seed.projects ?? []) projects.set(p.slug, p);
  for (const d of seed.decisions ?? []) decisions.push(d);
  for (const n of seed.dailyDocs ?? []) {
    dailyDocs.push(n);
    docs.set(n.id, n);
  }
  for (const e of seed.edges ?? []) edges.push(e);

  const ctx: McpToolContext = {
    documents: {
      findById: vi.fn(async (id: string) => docs.get(id) ?? null),
      getChunks: vi.fn(async (id: string) => chunks.get(id) ?? []),
      list: vi.fn(async (_filters, opts) => {
        const items = Array.from(docs.values());
        const limit = opts?.limit ?? 20;
        return { items: items.slice(0, limit), total: items.length, page: 1, limit };
      }),
      create: vi.fn(async (input): Promise<Document> => {
        const doc: Document = {
          id: nextId('doc'),
          source: input.source,
          sourceId: input.sourceId ?? null,
          title: input.title,
          rawText: input.rawText,
          cleanText: input.cleanText ?? null,
          contentHash: input.contentHash,
          tokenCount: input.tokenCount ?? null,
          language: input.language ?? null,
          type: input.type ?? null,
          metadata: (input.metadata ?? null) as Prisma.JsonValue,
          status: input.status ?? 'parsed',
          createdAt: new Date(),
          updatedAt: new Date(),
          ingestedAt: new Date(),
          enrichedAt: null,
          archivedAt: null,
          vaultPath: input.vaultPath ?? null,
        };
        docs.set(doc.id, doc);
        return doc;
      }),
      update: vi.fn(async (id, patch): Promise<Document> => {
        const existing = docs.get(id);
        if (!existing) throw new Error(`mock document not found: ${id}`);
        const updated: Document = {
          ...existing,
          updatedAt: new Date(),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata as Prisma.JsonValue } : {}),
          ...(patch.archived === true
            ? { archivedAt: new Date(), status: 'archived' as const }
            : patch.archived === false
              ? { archivedAt: null }
              : {}),
        };
        docs.set(id, updated);
        return updated;
      }),
      setProjects: vi.fn(async (_documentId: string, _projectIds: string[]) => {
        // no-op; tests assert via spy if needed.
      }),
      findByContentHash: vi.fn(async (hash: string) => {
        for (const doc of docs.values()) if (doc.contentHash === hash) return doc;
        return null;
      }),
      findDailyByDate: vi.fn(async (date: string) => {
        return (
          dailyDocs.find((d) => {
            const meta = (d.metadata ?? {}) as { date?: string };
            return (meta.date ?? d.sourceId ?? null) === date;
          }) ?? null
        );
      }),
      listDaily: vi.fn(async (from?: string, to?: string, limit?: number) => {
        let items = dailyDocs.slice();
        if (from) {
          items = items.filter((d) => {
            const key = ((d.metadata ?? {}) as { date?: string }).date ?? d.sourceId ?? '';
            return key >= from;
          });
        }
        if (to) {
          items = items.filter((d) => {
            const key = ((d.metadata ?? {}) as { date?: string }).date ?? d.sourceId ?? '';
            return key <= to;
          });
        }
        return items.slice(0, limit ?? items.length);
      }),
    },
    attachments: {
      findById: vi.fn(async () => null),
      setAnalysis: vi.fn(async () => ({}) as never),
      listForDocument: vi.fn(async () => []),
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
      findByNameWithJoins: vi.fn(async (name: string, type) => {
        const norm = name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
        for (const e of entities.values()) {
          if (e.normalizedName !== norm) continue;
          if (type && e.type !== type) continue;
          const matched = e;
          const matchedEdges = edges.filter(
            (edge) => edge.fromId === matched.id || edge.toId === matched.id,
          );
          return { entity: matched, documents: [], edges: matchedEdges };
        }
        return null;
      }),
      listTopForProject: vi.fn(async (_projectSlug: string, _limit?: number) => {
        // Mock: seed via the `entities` map; tests that want a curated ordering
        // can override on the bag itself before calling the tool.
        return Array.from(entities.values()).filter((e) => e.mergedIntoId === null);
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
      neighborhood: vi.fn(async (centerEntityId: string, depth = 1, maxNodes = 200) => {
        const visited = new Set<string>([centerEntityId]);
        const collected: Edge[] = [];
        let frontier = [centerEntityId];
        for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
          const nextFrontier: string[] = [];
          for (const edge of edges) {
            if (collected.includes(edge)) continue;
            if (!frontier.includes(edge.fromId) && !frontier.includes(edge.toId)) continue;
            if (edge.status !== 'auto_confirmed' && edge.status !== 'manual') continue;
            collected.push(edge);
            for (const id of [edge.fromId, edge.toId]) {
              if (!visited.has(id) && visited.size < maxNodes) {
                visited.add(id);
                nextFrontier.push(id);
              }
            }
          }
          frontier = nextFrontier;
        }
        return { nodeIds: visited, edges: collected };
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
          payload: input.payload as Prisma.JsonValue,
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
    projects: {
      list: vi.fn(async (opts) => {
        const items = Array.from(projects.values());
        const limit = opts?.limit ?? 20;
        return { items: items.slice(0, limit), total: items.length, page: 1, limit };
      }),
      findBySlug: vi.fn(async (slug: string) => projects.get(slug) ?? null),
      findByIds: vi.fn(async (ids: string[]) => {
        if (ids.length === 0) return [];
        return Array.from(projects.values()).filter((p) => ids.includes(p.id));
      }),
      update: vi.fn(async (slug, patch) => {
        const existing = projects.get(slug);
        if (!existing) throw new Error(`mock project not found: ${slug}`);
        const updated: Project = {
          ...existing,
          updatedAt: new Date(),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.contextMd !== undefined ? { contextMd: patch.contextMd } : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata as Prisma.JsonValue } : {}),
        };
        projects.set(slug, updated);
        return updated;
      }),
    },
    decisions: {
      list: vi.fn(async (filters, opts) => {
        let items = decisions.slice();
        if (filters?.projectSlug) {
          const project = projects.get(filters.projectSlug);
          items = project ? items.filter((d) => d.projectId === project.id) : [];
        }
        if (filters?.projectId) items = items.filter((d) => d.projectId === filters.projectId);
        if (filters?.status) items = items.filter((d) => d.status === filters.status);
        const limit = opts?.limit ?? 20;
        return { items: items.slice(0, limit), total: items.length, page: 1, limit };
      }),
      create: vi.fn(async (input): Promise<Decision> => {
        const d: Decision = {
          id: nextId('dec'),
          projectId: input.projectId ?? null,
          title: input.title,
          decision: input.decision,
          context: input.context ?? null,
          consequences: input.consequences ?? null,
          status: input.status ?? 'active',
          supersededById: input.supersededById ?? null,
          sourceDocumentId: input.sourceDocumentId ?? null,
          decidedAt: new Date(),
          createdAt: new Date(),
        };
        decisions.push(d);
        return d;
      }),
    },
    jobs: {
      create: vi.fn(async (input): Promise<Job> => {
        const job: Job = {
          id: nextId('job'),
          type: input.type,
          status: 'queued',
          priority: input.priority ?? 50,
          payload: input.payload as Prisma.JsonValue,
          result: null,
          error: null,
          documentId: input.documentId ?? null,
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 3,
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
          costEstimate: null,
        };
        jobsCreated.push(job);
        return job;
      }),
    },
    search: {
      findSimilar: vi.fn(async (_text: string, limit: number) => similar.slice(0, limit)),
      search: vi.fn(async (_opts: { query: string; filters?: SearchFilters }) => searchResults),
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
    enrichmentQueue: {
      add: vi.fn(async (name: string, data: EnrichmentJob, opts?: QueueAddOptions) => {
        const record: QueuedJobRecord<EnrichmentJob> = opts ? { name, data, opts } : { name, data };
        enrichmentJobsAdded.push(record);
        return { id: nextId('queue') };
      }),
    },
    indexingQueue: {
      add: vi.fn(async (name: string, data: IndexingJob, opts?: QueueAddOptions) => {
        const record: QueuedJobRecord<IndexingJob> = opts ? { name, data, opts } : { name, data };
        indexingJobsAdded.push(record);
        return { id: nextId('queue') };
      }),
    },
  };

  return {
    ctx,
    docs,
    chunks,
    entities,
    entitiesByNorm,
    edges,
    inboxItems,
    projects,
    decisions,
    dailyDocs,
    jobsCreated,
    enrichmentJobsAdded,
    indexingJobsAdded,
    get searchResults(): SearchResult {
      return searchResults;
    },
    set searchResults(value: SearchResult) {
      searchResults = value;
    },
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

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: nextId('proj'),
    slug: overrides.slug ?? 'demo',
    name: overrides.name ?? 'Demo',
    description: null,
    status: 'active',
    contextMd: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * ADR-0050: daily notes are Document(source='daily') rows with the
 * YYYY-MM-DD string in sourceId and `{date, mood}` in metadata. The
 * helper mirrors that shape so tool tests can seed `dailyDocs` and have
 * `findDailyByDate`/`listDaily` work like real data.
 */
export function makeDailyDoc(overrides: Partial<Document> & { date?: string } = {}): Document {
  const date = overrides.date ?? '2026-05-08';
  const base: Document = {
    id: nextId('daily'),
    source: 'daily' as SourceType,
    sourceId: date,
    title: `Daily ${date}`,
    rawText: 'note',
    cleanText: null,
    contentHash: `daily:${date}`,
    tokenCount: null,
    language: null,
    type: 'note',
    metadata: { date, mood: null } as Prisma.JsonValue,
    status: 'raw',
    createdAt: new Date(`${date}T00:00:00.000Z`),
    updatedAt: new Date(`${date}T00:00:00.000Z`),
    ingestedAt: new Date(`${date}T00:00:00.000Z`),
    enrichedAt: null,
    archivedAt: null,
    vaultPath: null,
  };
  const { date: _drop, ...rest } = overrides;
  return { ...base, ...rest };
}

export function seedEntity(name: string, type: EntityType): Entity {
  return makeEntity({ name, normalizedName: name.toLowerCase(), type });
}
