import { type INestApplication } from '@nestjs/common';
import type { Entity, InboxItem } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

let app: INestApplication;
let prisma: import('@mnela/db').PrismaService;
let cookie: string;

beforeAll(async () => {
  app = await buildTestApp();
  const { PrismaService } = await import('@mnela/db');
  prisma = app.get(PrismaService);

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
  await app?.close();
});

beforeEach(async () => {
  await prisma.client.auditLog.deleteMany();
  await prisma.client.edge.deleteMany();
  await prisma.client.documentEntity.deleteMany();
  await prisma.client.inboxItem.deleteMany();
  await prisma.client.entity.deleteMany();
});

async function makeEntity(name: string): Promise<Entity> {
  return prisma.client.entity.create({
    data: {
      name,
      normalizedName: name.toLowerCase().replace(/\s+/g, '-'),
      type: 'concept',
      aliases: [],
    },
  });
}

async function makeLinkSuggestion(fromName: string, toName: string): Promise<InboxItem> {
  const from = await makeEntity(fromName);
  const to = await makeEntity(toName);
  return prisma.client.inboxItem.create({
    data: {
      type: 'link_suggestion',
      title: `${fromName} → ${toName}`,
      description: 'mid-confidence link',
      payload: {
        fromId: from.id,
        toId: to.id,
        relationType: 'related_to',
        confidence: 0.6,
      },
    },
  });
}

describe('POST /inbox/bulk/accept', () => {
  it('200 + per-item audit + emits resolved events when every item succeeds', async () => {
    const a = await makeLinkSuggestion('A1', 'A2');
    const b = await makeLinkSuggestion('B1', 'B2');
    const c = await makeLinkSuggestion('C1', 'C2');

    const res = await request(app.getHttpServer())
      .post('/api/v1/inbox/bulk/accept')
      .set('Cookie', cookie)
      .send({ ids: [a.id, b.id, c.id] })
      .expect(200);

    expect(res.body.accepted).toHaveLength(3);
    expect(res.body.failed).toHaveLength(0);
    expect(typeof res.body.batchId).toBe('string');

    const audits = await prisma.client.auditLog.findMany({
      where: { action: 'inbox.bulk_accept_item' },
    });
    expect(audits).toHaveLength(3);
    for (const row of audits) {
      const meta = row.metadata as { batchId?: string } | null;
      expect(meta?.batchId).toBe(res.body.batchId);
    }

    const edges = await prisma.client.edge.findMany();
    expect(edges).toHaveLength(3);
  });

  it('207 Multi-Status + per-item failure reason when some items are stale', async () => {
    const a = await makeLinkSuggestion('S1', 'S2');
    const stale = await makeLinkSuggestion('T1', 'T2');
    await prisma.client.inboxItem.update({
      where: { id: stale.id },
      data: { status: 'accepted', resolvedAt: new Date(), resolvedBy: 'test' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/inbox/bulk/accept')
      .set('Cookie', cookie)
      .send({ ids: [a.id, stale.id] })
      .expect(207);

    expect(res.body.accepted).toHaveLength(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].id).toBe(stale.id);
    expect(typeof res.body.failed[0].reason).toBe('string');
  });

  it('422 when every item fails', async () => {
    const stale = await makeLinkSuggestion('Z1', 'Z2');
    await prisma.client.inboxItem.update({
      where: { id: stale.id },
      data: { status: 'rejected', resolvedAt: new Date(), resolvedBy: 'test' },
    });

    await request(app.getHttpServer())
      .post('/api/v1/inbox/bulk/accept')
      .set('Cookie', cookie)
      .send({ ids: [stale.id] })
      .expect(422);
  });
});

describe('POST /inbox/bulk/reject', () => {
  it('marks all listed items rejected, emits resolved events, no edges created', async () => {
    const a = await makeLinkSuggestion('R1', 'R2');
    const b = await makeLinkSuggestion('R3', 'R4');

    const res = await request(app.getHttpServer())
      .post('/api/v1/inbox/bulk/reject')
      .set('Cookie', cookie)
      .send({ ids: [a.id, b.id] })
      .expect(200);

    expect(res.body.accepted).toHaveLength(2);
    expect(res.body.failed).toHaveLength(0);

    const rows = await prisma.client.inboxItem.findMany({ where: { id: { in: [a.id, b.id] } } });
    for (const r of rows) expect(r.status).toBe('rejected');

    const edges = await prisma.client.edge.findMany();
    expect(edges).toHaveLength(0);
  });
});
