import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HealthModule } from '../src/health/health.module.js';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Boot only the HealthModule so the smoke test stays free of Prisma/Redis
    // dependencies; full McpModule wiring is exercised by integration tests.
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
