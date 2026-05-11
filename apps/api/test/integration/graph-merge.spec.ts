import { type INestApplication } from '@nestjs/common';
import type { Entity } from '@prisma/client';
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
  await prisma.client.edge.deleteMany();
  await prisma.client.documentEntity.deleteMany();
  await prisma.client.entity.deleteMany();
});

async function makeEntity(name: string, normalizedName?: string): Promise<Entity> {
  return prisma.client.entity.create({
    data: {
      name,
      normalizedName: normalizedName ?? name.toLowerCase().replace(/\s+/g, '-'),
      type: 'concept',
      aliases: [],
    },
  });
}

describe('POST /graph/entities/merge — dedupe + dryRun (ADR-0036)', () => {
  it('dryRun returns counts and rolls back; second call commits', async () => {
    const source = await makeEntity('SourceX', 'sourcex');
    const target = await makeEntity('TargetY', 'targety');
    const neighbor = await makeEntity('Neighbor', 'neighbor-merge');

    await prisma.client.edge.create({
      data: {
        fromId: source.id,
        toId: neighbor.id,
        relationType: 'related_to',
        confidence: 0.5,
        status: 'auto_confirmed',
      },
    });
    await prisma.client.edge.create({
      data: {
        fromId: target.id,
        toId: neighbor.id,
        relationType: 'related_to',
        confidence: 0.9,
        status: 'auto_confirmed',
      },
    });

    const dryRes = await request(app.getHttpServer())
      .post('/api/v1/graph/entities/merge')
      .set('Cookie', cookie)
      .send({ sourceId: source.id, targetId: target.id, dryRun: true })
      .expect(200);

    expect(dryRes.body.dryRun).toBe(true);
    expect(dryRes.body.counts.edgeDedupes).toBe(1);
    expect(dryRes.body.counts.edgeRepoints + dryRes.body.counts.edgeDedupes).toBe(1);
    // DB untouched
    const stillUnmerged = await prisma.client.entity.findUnique({ where: { id: source.id } });
    expect(stillUnmerged?.mergedIntoId).toBeNull();
    const edgesAfterDry = await prisma.client.edge.findMany();
    expect(edgesAfterDry).toHaveLength(2);

    const commitRes = await request(app.getHttpServer())
      .post('/api/v1/graph/entities/merge')
      .set('Cookie', cookie)
      .send({ sourceId: source.id, targetId: target.id })
      .expect(200);

    expect(commitRes.body.dryRun).toBe(false);
    const edgesAfterCommit = await prisma.client.edge.findMany();
    expect(edgesAfterCommit).toHaveLength(1);
    expect(edgesAfterCommit[0]!.confidence).toBe(0.9);
    expect(edgesAfterCommit[0]!.fromId).toBe(target.id);

    const merged = await prisma.client.entity.findUnique({ where: { id: source.id } });
    expect(merged?.mergedIntoId).toBe(target.id);
  });

  it('removes self-loops produced by repoint', async () => {
    const source = await makeEntity('SourceSL', 'source-sl');
    const target = await makeEntity('TargetSL', 'target-sl');

    // source —x→ target: after merge becomes target —x→ target (self-loop)
    await prisma.client.edge.create({
      data: { fromId: source.id, toId: target.id, relationType: 'related_to', confidence: 1 },
    });

    await request(app.getHttpServer())
      .post('/api/v1/graph/entities/merge')
      .set('Cookie', cookie)
      .send({ sourceId: source.id, targetId: target.id })
      .expect(200);

    const edges = await prisma.client.edge.findMany();
    expect(edges).toHaveLength(0);
  });

  it('rejects self-merge with 400', async () => {
    const e = await makeEntity('Solo', 'solo-merge');
    await request(app.getHttpServer())
      .post('/api/v1/graph/entities/merge')
      .set('Cookie', cookie)
      .send({ sourceId: e.id, targetId: e.id })
      .expect(400);
  });
});
