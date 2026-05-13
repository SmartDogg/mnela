/**
 * Integration test for the Phase 5 enrichment pipeline.
 *
 * Spins postgres+redis via testcontainers (test/setup.ts), boots a real Prisma
 * client, mocks `runClaude` to (a) invoke the mcp-tools handlers directly to
 * simulate what serverside Claude would have done, then (b) return a structured
 * summary for the pipeline to parse.
 */
import {
  AuditLogRepository,
  DecisionRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  JobRepository,
  type Principal,
  ProjectRepository,
} from '@mnela/db';
import { addEntities, addLinks, type McpToolContext } from '@mnela/mcp-tools';
import { writeClaudeStatus } from '@mnela/queue';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We no longer mock @mnela/claude-runner directly — the pipeline now talks
// to LLMProvider instances built by OrchestratorProvidersService. Tests
// supply a fake provider that implements the `.run(...)` shortcut.

interface FakeRun {
  text: string;
  final:
    | { type: 'done' }
    | { type: 'error'; reason: 'rate-limit'; resetAt?: Date }
    | { type: 'error'; reason: 'auth' }
    | { type: 'error'; reason: 'generic'; message?: string };
}

const runMock = vi.fn<(args: { prompt: string }) => Promise<FakeRun>>();

const { EnrichmentPipeline } = await import('../../src/enrichment/pipeline.js');
const { ClaudeStatusService } = await import('../../src/claude-status/claude-status.service.js');
const { RateLimitService } = await import('../../src/rate-limit/rate-limit.service.js');

let prisma: PrismaClient;
let redis: Redis;

beforeEach(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
  redis = new Redis(process.env['REDIS_URL']!, { lazyConnect: true });
  await redis.connect();

  // Clean slate.
  await prisma.inboxItem.deleteMany();
  await prisma.edge.deleteMany();
  await prisma.documentEntity.deleteMany();
  await prisma.entity.deleteMany();
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await redis.flushall();

  await writeClaudeStatus(redis, { available: true, checkedAt: new Date().toISOString() });
});

afterEach(async () => {
  await prisma.$disconnect();
  redis.disconnect();
  runMock.mockReset();
});

function buildCtx(): McpToolContext {
  const documents = new DocumentRepository(() => prisma);
  const entities = new EntityRepository(() => prisma);
  const edges = new EdgeRepository(() => prisma);
  const documentEntities = new DocumentEntityRepository(() => prisma);
  const inbox = new InboxRepository(() => prisma);
  const audit = new AuditLogRepository(() => prisma);
  const projects = new ProjectRepository(() => prisma);
  const decisions = new DecisionRepository(() => prisma);
  const jobs = new JobRepository(() => prisma);
  const principal: Principal = {
    kind: 'token',
    id: 'system:test',
    name: 'test-orchestrator',
    scope: 'mcp',
  };
  return {
    documents,
    entities,
    edges,
    documentEntities,
    inbox,
    audit,
    projects,
    decisions,
    jobs,
    auditTx: (fn) => prisma.$transaction((tx) => fn(tx)),
    principal,
    search: {
      findSimilar: async () => [],
      search: async (opts) => ({
        mode: 'fts',
        hits: [],
        total: 0,
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
      }),
    },
    events: {
      graphNodeAdded: () => undefined,
      graphEdgeAdded: () => undefined,
      inboxItemAdded: () => undefined,
    },
    enrichmentQueue: { add: async () => ({ id: undefined }) },
    indexingQueue: { add: async () => ({ id: undefined }) },
  };
}

async function createDoc(): Promise<string> {
  const repo = new DocumentRepository(() => prisma);
  const doc = await repo.create({
    source: 'manual_upload',
    title: 'Test note',
    rawText: 'React works with Vite. Acme competes with Beta.',
    contentHash: `hash-${Date.now()}`,
    status: 'parsed',
  });
  return doc.id;
}

function buildPipeline() {
  const claudeStatus = new ClaudeStatusService({ client: redis } as never);
  const rateLimit = new RateLimitService();
  // Skip the BullMQ wiring (we're not actually pumping the queue here).
  Object.defineProperty(rateLimit, 'isPaused', { value: vi.fn(async () => false) });
  Object.defineProperty(rateLimit, 'pause', { value: vi.fn(async () => undefined) });
  const fakeProvider = {
    config: { id: 'builtin:claude-cli', kind: 'claude_cli', name: 'cli', model: '' },
    supportsTools: true,
    supportsVision: true,
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<never> {
      // unused — tests drive the fake provider via .run()
      return;
    },
    async test() {
      return { ok: true, latencyMs: 1 };
    },
    run: (args: { prompt: string }) => runMock(args),
  };
  const providers = {
    resolveForFeature: vi.fn(async () => fakeProvider),
  };
  return new EnrichmentPipeline(
    new DocumentRepository(() => prisma),
    {} as never, // attachments — image-analysis path is not exercised by these tests
    {} as never, // entities
    {} as never, // documentEntities
    { client: redis } as never,
    claudeStatus,
    rateLimit as never,
    { get: vi.fn(async () => null) } as never, // systemConfig
    providers as never,
  );
}

describe('enrichment pipeline (integration)', () => {
  it('writes entities, auto-confirmed edges, and Inbox suggestions through mcp-tools', async () => {
    const documentId = await createDoc();

    runMock.mockImplementationOnce(async () => {
      const ctx = buildCtx();
      // Simulate what server-side Claude would do via stdio MCP.
      await addEntities(
        {
          documentId,
          entities: [
            { name: 'React', type: 'technology', confidence: 0.95 },
            { name: 'Vite', type: 'technology', confidence: 0.9 },
            { name: 'Acme', type: 'organization', confidence: 0.85 },
            { name: 'Beta', type: 'organization', confidence: 0.85 },
          ],
        },
        ctx,
      );
      await addLinks(
        {
          links: [
            {
              fromEntity: { name: 'React', type: 'technology' },
              toEntity: { name: 'Vite', type: 'technology' },
              relationType: 'works_with',
              confidence: 0.95,
              evidenceDocumentId: documentId,
            },
            {
              fromEntity: { name: 'Acme', type: 'organization' },
              toEntity: { name: 'Beta', type: 'organization' },
              relationType: 'competes_with',
              confidence: 0.65,
              evidenceDocumentId: documentId,
            },
          ],
        },
        ctx,
      );
      return {
        text: 'done. {"summary":"two pairs","addedEntitiesCount":4,"addedEdgesCount":1,"droppedLowConfidence":0}',
        final: { type: 'done' as const },
      };
    });

    const pipeline = buildPipeline();
    const outcome = await pipeline.run({ dbJobId: 'job-1', documentId });

    expect(outcome.status).toBe('enriched');
    expect(outcome.addedEntities).toBe(4);

    const entities = await prisma.entity.findMany();
    expect(entities.map((e) => e.name).sort()).toEqual(['Acme', 'Beta', 'React', 'Vite']);

    const edges = await prisma.edge.findMany();
    const auto = edges.filter((e) => e.status === 'auto_confirmed');
    const review = edges.filter((e) => e.status === 'needs_review');
    expect(auto).toHaveLength(1);
    expect(review).toHaveLength(1);

    const inbox = await prisma.inboxItem.findMany();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('link_suggestion');

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    expect(doc?.status).toBe('enriched');
  });

  it('on rate-limit hit, marks document parsed and pauses (no graph writes)', async () => {
    const documentId = await createDoc();

    runMock.mockResolvedValueOnce({
      text: '',
      final: { type: 'error', reason: 'rate-limit', resetAt: new Date(Date.now() + 60_000) },
    });

    const pipeline = buildPipeline();
    const outcome = await pipeline.run({ dbJobId: 'job-2', documentId });

    expect(outcome.status).toBe('rate-limited');

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    expect(doc?.status).toBe('parsed');

    expect(await prisma.entity.count()).toBe(0);
    expect(await prisma.edge.count()).toBe(0);
  });
});
