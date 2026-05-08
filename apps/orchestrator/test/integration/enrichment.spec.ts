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
  DocumentEntityRepository,
  DocumentRepository,
  EdgeRepository,
  EntityRepository,
  InboxRepository,
  type Principal,
} from '@mnela/db';
import { addEntities, addLinks, type McpToolContext } from '@mnela/mcp-tools';
import { writeClaudeStatus } from '@mnela/queue';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runClaudeMock = vi.fn();
vi.mock('@mnela/claude-runner', () => ({
  runClaude: runClaudeMock,
  claudeAvailable: vi.fn(async () => true),
  claudeTest: vi.fn(async () => ({ ok: true, version: '1.0.0', loggedIn: true, latencyMs: 1 })),
}));

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
  runClaudeMock.mockReset();
});

function buildCtx(): McpToolContext {
  const documents = new DocumentRepository(() => prisma);
  const entities = new EntityRepository(() => prisma);
  const edges = new EdgeRepository(() => prisma);
  const documentEntities = new DocumentEntityRepository(() => prisma);
  const inbox = new InboxRepository(() => prisma);
  const audit = new AuditLogRepository(() => prisma);
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
    auditTx: (fn) => prisma.$transaction((tx) => fn(tx)),
    principal,
    search: { findSimilar: async () => [] },
    events: {
      graphNodeAdded: () => undefined,
      graphEdgeAdded: () => undefined,
      inboxItemAdded: () => undefined,
    },
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
  return new EnrichmentPipeline(
    new DocumentRepository(() => prisma),
    { client: redis } as never,
    claudeStatus,
    rateLimit as never,
  );
}

describe('enrichment pipeline (integration)', () => {
  it('writes entities, auto-confirmed edges, and Inbox suggestions through mcp-tools', async () => {
    const documentId = await createDoc();

    runClaudeMock.mockImplementationOnce(async () => {
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
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        frames: [],
        result: {
          type: 'result' as const,
          session_id: 's',
          result:
            'done. {"summary":"two pairs","addedEntitiesCount":4,"addedEdgesCount":1,"droppedLowConfidence":0}',
        },
        rateLimitHit: null,
        authError: null,
        timedOut: false,
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

    runClaudeMock.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
      frames: [],
      result: {
        type: 'result' as const,
        session_id: 's',
        result: "You've hit your session limit · resets 3:45pm",
        is_error: true,
      },
      rateLimitHit: { resetAt: new Date(Date.now() + 60_000), raw: '...', source: 'result_text' },
      authError: null,
      timedOut: false,
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
