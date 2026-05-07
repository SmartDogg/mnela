import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

const SAMPLE_TEXT = `# Phase 1 Golden Path
Mnela is a self-hosted second brain. The api is built with NestJS and Postgres.
Search uses Postgres FTS plus pg_trgm for fuzzy matching.
`;

let app: INestApplication;
let prisma: import('../../src/prisma.service.js').PrismaService;
let cookie: string;
let createdDocId: string;

beforeAll(async () => {
  app = await buildTestApp();
  const { PrismaService } = await import('../../src/prisma.service.js');
  prisma = app.get(PrismaService);

  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);

  const setCookie = login.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no set-cookie header on login response');
  cookie = raw.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

describe('Phase 1 golden path', () => {
  it('returns the current admin from /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ kind: 'admin', scope: 'admin', name: ADMIN_USERNAME });
  });

  it('uploads a markdown document', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(SAMPLE_TEXT, 'utf-8'), {
        filename: 'golden.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.document.title).toBe('golden');
    expect(res.body.document.status).toBe('parsed');
    expect(res.body.document.contentHash).toMatch(/^[0-9a-f]{64}$/);
    createdDocId = res.body.document.id;
  });

  it('detects a duplicate upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(SAMPLE_TEXT, 'utf-8'), {
        filename: 'golden-again.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.document.id).toBe(createdDocId);
  });

  it('rejects binary uploads with 415', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(415);
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

  it('returns 503 for /search/ask (Phase 5)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/search/ask')
      .set('Cookie', cookie)
      .send({ question: 'who am i?' })
      .expect(503);
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
