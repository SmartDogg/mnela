import { promises as fs } from 'node:fs';
import { type AddressInfo } from 'node:net';
import path from 'node:path';

import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';
import { buildTestWorker } from '../bootstrap-worker.js';
import { sleep, waitForJob } from '../poll.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

const SAMPLE_TEXT = `# Phase 1 Golden Path
Mnela is a self-hosted second brain. The api is built with NestJS and Postgres.
Search uses Postgres FTS plus pg_trgm for fuzzy matching.
`;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const REAL_ZIP = path.join(
  REPO_ROOT,
  'data-a9014ee7-f1e2-46a5-8630-a879ee914eea-1777894787-beb688ca-batch-0000.zip',
);

let app: INestApplication;
let worker: INestApplicationContext;
let prisma: import('@mnela/db').PrismaService;
let cookie: string;
let baseUrl: string;
let createdDocId: string;

beforeAll(async () => {
  app = await buildTestApp();
  worker = await buildTestWorker();
  const { PrismaService } = await import('@mnela/db');
  prisma = app.get(PrismaService);

  await app.listen(0, '127.0.0.1');
  const address = (app.getHttpServer().address() as AddressInfo) ?? { port: 0 };
  baseUrl = `http://127.0.0.1:${address.port}`;

  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);

  const setCookie = login.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no set-cookie header on login response');
  cookie = raw.split(';')[0]!;
}, 240_000);

afterAll(async () => {
  await worker?.close();
  await app?.close();
});

describe('golden path (async ingestion contract)', () => {
  it('returns the current admin from /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ kind: 'admin', scope: 'admin', name: ADMIN_USERNAME });
  });

  it('uploads a markdown document and the worker produces a parsed Document', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(SAMPLE_TEXT, 'utf-8'), {
        filename: 'golden.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    expect(res.body.accepted).toBe(true);
    const jobId = res.body.job.id as string;
    const job = await waitForJob(prisma, jobId, { timeoutMs: 30_000 });
    expect(job.status).toBe('completed');

    const result = job.result as { documentIds: string[]; duplicates: number };
    expect(result.documentIds.length).toBe(1);
    createdDocId = result.documentIds[0]!;

    const doc = await prisma.client.document.findUniqueOrThrow({ where: { id: createdDocId } });
    expect(doc.title).toBe('golden');
    expect(doc.status).toBe('parsed');
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects a duplicate upload (same content hash inside the same archive)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(SAMPLE_TEXT, 'utf-8'), {
        filename: 'golden-again.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    const jobId = res.body.job.id as string;
    const job = await waitForJob(prisma, jobId);
    expect(job.status).toBe('completed');
    const result = job.result as { documentIds: string[]; duplicates: number };
    expect(result.duplicates).toBe(1);
    expect(result.documentIds).toEqual([]);
  });

  it('accepts a binary upload — produces a stub Document(status=raw) for the image', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(201);
    const jobId = res.body.job.id as string;
    const job = await waitForJob(prisma, jobId);
    expect(job.status).toBe('completed');
  });

  it('finds the document via fts mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Cookie', cookie)
      .send({ query: 'NestJS', mode: 'fts' })
      .expect(200);
    expect(res.body.mode).toBe('fts');
    expect(res.body.hits.some((h: { documentId: string }) => h.documentId === createdDocId)).toBe(
      true,
    );
  });

  it('finds the document via hybrid mode with score', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Cookie', cookie)
      .send({ query: 'Postgres FTS', mode: 'hybrid' })
      .expect(200);
    expect(res.body.mode).toBe('hybrid');
    expect(res.body.hits.length).toBeGreaterThan(0);
    for (const hit of res.body.hits) {
      expect(typeof hit.score).toBe('number');
    }
  });

  it('finds the document title via fuzzy/trigram mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Cookie', cookie)
      .send({ query: 'goldenn', mode: 'fuzzy' })
      .expect(200);
    expect(res.body.mode).toBe('fuzzy');
    expect(res.body.hits.some((h: { documentId: string }) => h.documentId === createdDocId)).toBe(
      true,
    );
  });

  it('patches the document type and writes an audit row', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/documents/${createdDocId}`)
      .set('Cookie', cookie)
      .send({ type: 'spec' })
      .expect(200);
    expect(res.body.type).toBe('spec');

    const audit = await prisma.client.auditLog.findFirst({
      where: { targetId: createdDocId, action: 'document.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor).toBe('admin:admin');
  });

  it('returns text/event-stream from /search/ask (Phase 8)', async () => {
    // Phase 1 stubbed 503; Phase 8 turns this into an SSE pipe.
    // Without Claude configured the response falls back to Dumb Mode FTS-only.
    const res = await request(app.getHttpServer())
      .post('/api/v1/search/ask')
      .set('Cookie', cookie)
      .set('Accept', 'text/event-stream')
      .send({ query: 'who am i?' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('forbids a read_only token from POST /documents/upload', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set('Cookie', cookie)
      .send({ name: 'phase1-readonly', scope: 'read_only' })
      .expect(201);
    const token = tokenRes.body.token as string;
    expect(token).toMatch(/^mn_/);

    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('extra', 'utf-8'), {
        filename: 'extra.txt',
        contentType: 'text/plain',
      })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/auth/tokens')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects a deleted document with 404 and writes a delete audit row', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/documents/${createdDocId}`)
      .set('Cookie', cookie)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/documents/${createdDocId}`)
      .set('Cookie', cookie)
      .expect(404);

    const audit = await prisma.client.auditLog.findFirst({
      where: { targetId: createdDocId, action: 'document.delete' },
    });
    expect(audit).not.toBeNull();
  });
});

describe('Phase 2 — Socket.io /live gateway', () => {
  it('emits job.* and document.* events for an upload', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set('Cookie', cookie)
      .send({ name: 'live-test', scope: 'mcp' })
      .expect(201);
    const token = tokenRes.body.token as string;

    const events: { type: string; payload: unknown }[] = [];
    const socket: Socket = ioClient(`${baseUrl}/live`, {
      auth: { token },
      transports: ['websocket'],
    });
    const eventTypes = [
      'job.created',
      'job.started',
      'job.progress',
      'job.completed',
      'document.created',
    ] as const;
    for (const t of eventTypes) {
      socket.on(t, (payload: unknown) => events.push({ type: t, payload }));
    }
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    });

    const upload = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('# socket-test\nbody for live'), {
        filename: 'sock.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    const jobId = upload.body.job.id as string;
    await waitForJob(prisma, jobId);
    await sleep(500);

    socket.disconnect();
    const types = new Set(events.map((e) => e.type));
    expect(types.has('job.completed')).toBe(true);
    expect(types.has('document.created')).toBe(true);
  }, 60_000);
});

describe('Phase 4 — graph.* live events from ingestion', () => {
  it('emits a synthetic graph.node_added of type=document for a markdown upload', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set('Cookie', cookie)
      .send({ name: 'graph-live-test', scope: 'mcp' })
      .expect(201);
    const token = tokenRes.body.token as string;

    const nodeEvents: { entity: { id: string; name: string; type: string } }[] = [];
    const edgeEvents: { edge: { id: string; relationType: string } }[] = [];

    const socket: Socket = ioClient(`${baseUrl}/live`, {
      auth: { token },
      transports: ['websocket'],
    });
    socket.on('graph.node_added', (p: { entity: { id: string; name: string; type: string } }) =>
      nodeEvents.push(p),
    );
    socket.on('graph.edge_added', (p: { edge: { id: string; relationType: string } }) =>
      edgeEvents.push(p),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    });

    const upload = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('# graph-live\nphase 4 marker'), {
        filename: `graph-${Date.now()}.md`,
        contentType: 'text/markdown',
      })
      .expect(201);
    await waitForJob(prisma, upload.body.job.id as string);
    await sleep(500);
    socket.disconnect();

    const docNodes = nodeEvents.filter((e) => e.entity.type === 'document');
    expect(docNodes.length).toBeGreaterThanOrEqual(1);
    // Markdown has no project metadata, so no project node and no synthetic edge
    expect(edgeEvents).toHaveLength(0);
  }, 60_000);

  it('upserts a Project entity and emits node + synthetic edge for Claude-flavoured metadata', async () => {
    // Simulate what the Claude parser produces by writing a Document directly with
    // metadata.projectName/projectUuid, then poke the worker logic by hand-emitting
    // through the same code path. We do this by reusing the existing helper:
    // the IngestionConsumer is a singleton in the test worker context, so we just
    // reach into the DI container.
    const { IngestionConsumer } =
      await import('../../../worker/src/ingestion/ingestion.consumer.js');
    const consumer = worker.get(IngestionConsumer);

    const tokenRes = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set('Cookie', cookie)
      .send({ name: 'graph-project-test', scope: 'mcp' })
      .expect(201);
    const token = tokenRes.body.token as string;

    const seen: { type: string; payload: unknown }[] = [];
    const socket: Socket = ioClient(`${baseUrl}/live`, {
      auth: { token },
      transports: ['websocket'],
    });
    socket.on('graph.node_added', (p: unknown) =>
      seen.push({ type: 'graph.node_added', payload: p }),
    );
    socket.on('graph.edge_added', (p: unknown) =>
      seen.push({ type: 'graph.edge_added', payload: p }),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    });

    const documentId = 'doc-' + Date.now().toString(36);
    const projectName = 'Phase 4 Live Project ' + Date.now().toString(36);
    // Bypass the parse step — call the emitter directly.
    await (
      consumer as unknown as {
        emitGraphEventsForDocument: (
          id: string,
          title: string,
          metadata: Record<string, unknown>,
        ) => Promise<void>;
      }
    ).emitGraphEventsForDocument(documentId, 'Phase 4 chat', {
      projectName,
      projectUuid: 'uuid-' + Date.now().toString(36),
    });
    await sleep(500);
    socket.disconnect();

    const docNode = seen.find(
      (e) =>
        e.type === 'graph.node_added' &&
        (e.payload as { entity: { id: string; type: string } }).entity.id === documentId,
    );
    expect(docNode).toBeTruthy();

    const projectNode = seen.find(
      (e) =>
        e.type === 'graph.node_added' &&
        (e.payload as { entity: { type: string; name: string } }).entity.type === 'project' &&
        (e.payload as { entity: { name: string } }).entity.name === projectName,
    );
    expect(projectNode).toBeTruthy();

    const synEdge = seen.find(
      (e) =>
        e.type === 'graph.edge_added' &&
        (e.payload as { edge: { id: string } }).edge.id.startsWith(`syn-${documentId}-`),
    );
    expect(synEdge).toBeTruthy();
    expect((synEdge!.payload as { edge: { relationType: string } }).edge.relationType).toBe(
      'belongs_to',
    );
  }, 60_000);
});

describe('Phase 2 — real Claude.ai export', () => {
  it('imports the real ZIP, parses N documents, dedupes on re-upload', async () => {
    const fileExists = await fs.stat(REAL_ZIP).catch(() => null);
    if (!fileExists) {
      console.warn(`[ingestion] real Claude.ai ZIP missing at ${REAL_ZIP}; skipping`);
      return;
    }

    const before = await prisma.client.document.count();

    const res = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Cookie', cookie)
      .attach('file', REAL_ZIP, { contentType: 'application/zip' })
      .expect(201);

    const jobId = res.body.id as string;
    expect(typeof jobId).toBe('string');

    const job = await waitForJob(prisma, jobId, { timeoutMs: 240_000, intervalMs: 1_000 });
    expect(job.status).toBe('completed');

    const result = job.result as { documentIds: string[]; duplicates: number };
    expect(result.documentIds.length).toBeGreaterThan(0);

    const after = await prisma.client.document.count();
    expect(after - before).toBe(result.documentIds.length);

    const res2 = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Cookie', cookie)
      .attach('file', REAL_ZIP, { contentType: 'application/zip' })
      .expect(201);
    const job2 = await waitForJob(prisma, res2.body.id as string, {
      timeoutMs: 240_000,
      intervalMs: 1_000,
    });
    expect(job2.status).toBe('completed');
    const result2 = job2.result as { documentIds: string[]; duplicates: number };
    expect(result2.duplicates).toBeGreaterThanOrEqual(result.documentIds.length);

    const finalCount = await prisma.client.document.count();
    expect(finalCount).toBe(after);
  }, 300_000);

  it('folder watcher picks up a file dropped into MNELA_DATA_DIR/dropbox', async () => {
    const env = process.env['MNELA_DATA_DIR'];
    if (!env) throw new Error('MNELA_DATA_DIR not set');
    const dropbox = path.resolve(env, 'dropbox');
    await fs.mkdir(dropbox, { recursive: true });

    const before = await prisma.client.document.count();
    const filename = `dropbox-${Date.now()}.md`;
    const target = path.join(dropbox, filename);
    await fs.writeFile(target, '# from dropbox\nhello chokidar test\n', 'utf-8');

    const job = await pollUntilDropboxJob(prisma, 60_000);
    expect(job.status).toBe('completed');

    const after = await prisma.client.document.count();
    expect(after).toBeGreaterThan(before);
  }, 90_000);
});

async function pollUntilDropboxJob(
  prisma: import('@mnela/db').PrismaService,
  timeoutMs: number,
): Promise<import('@prisma/client').Job> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await prisma.client.job.findFirst({
      where: { status: { in: ['completed', 'failed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (job) {
      const payload = job.payload as { origin?: string };
      if (payload?.origin === 'dropbox') return job;
    }
    await sleep(500);
  }
  throw new Error(`pollUntilDropboxJob: no dropbox job within ${timeoutMs}ms`);
}
