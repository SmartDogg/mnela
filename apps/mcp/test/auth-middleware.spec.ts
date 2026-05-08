import { createHash } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthTokenRepository, PrismaService } from '@mnela/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetEnvCache } from '../src/env.js';

let app: INestApplication;
let prisma: PrismaService;
let tokens: AuthTokenRepository;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

beforeAll(async () => {
  resetEnvCache();
  // Lazy-import McpModule so loadEnv() at its top level sees the env vars set
  // by the testcontainers setup (which runs in a beforeAll).
  const { McpModule } = await import('../src/mcp.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [McpModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  await app.init();
  prisma = app.get(PrismaService);
  tokens = app.get(AuthTokenRepository);
}, 240_000);

afterAll(async () => {
  await app?.close();
});

describe('Bearer auth middleware on /mcp', () => {
  it('leaves /health open (no Authorization header → 200)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 401 problem+json when Authorization is missing', async () => {
    const res = await request(app.getHttpServer()).post('/mcp').send({});
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'about:blank',
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing or invalid Bearer token',
    });
  });

  it('returns 401 when the Bearer token is unknown', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', 'Bearer mn_not_a_real_token')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.title).toBe('Unauthorized');
  });

  it('returns 401 for a revoked token', async () => {
    const plaintext = `mn_revoked_${Date.now()}`;
    const created = await tokens.create({
      name: 'revoked-mcp',
      tokenHash: sha256Hex(plaintext),
      scope: 'mcp',
    });
    await tokens.revoke(created.id);

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({});
    expect(res.status).toBe(401);

    await prisma.client.authToken.delete({ where: { id: created.id } });
  });

  it('returns 401 for an expired token', async () => {
    const plaintext = `mn_expired_${Date.now()}`;
    const created = await tokens.create({
      name: 'expired-mcp',
      tokenHash: sha256Hex(plaintext),
      scope: 'mcp',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({});
    expect(res.status).toBe(401);

    await prisma.client.authToken.delete({ where: { id: created.id } });
  });
});
