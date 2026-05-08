import { type INestApplication } from '@nestjs/common';
import type { JobStatus, JobType } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

interface ThroughputResponse {
  buckets: { ts: string; count: number }[];
}

interface DurationsResponse {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  total: number;
}

interface ErrorRateResponse {
  totalCompleted: number;
  totalFailed: number;
  rate: number;
}

let app: INestApplication;
let prisma: import('../../src/prisma.service.js').PrismaService;
let cookie: string;

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
}, 240_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await prisma.client.job.deleteMany();
});

interface SeedJob {
  type?: JobType;
  status: JobStatus;
  createdAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
}

async function seedJob(input: SeedJob): Promise<void> {
  await prisma.client.job.create({
    data: {
      type: input.type ?? 'parse_document',
      status: input.status,
      payload: {},
      createdAt: input.createdAt ?? new Date(),
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      error: input.error ?? null,
    },
  });
}

async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/${path}`)
    .query(query)
    .set('Cookie', cookie)
    .expect(200);
  return res.body as T;
}

describe('GET /jobs/stats/throughput', () => {
  it('groups completed jobs by minute over the requested window', async () => {
    const now = Date.now();
    // Three completions distributed across two distinct minute buckets within 1h.
    // Pick fixed minute floors to avoid clock drift across the test window.
    const tenMinAgoFloor = new Date(Math.floor((now - 10 * 60_000) / 60_000) * 60_000);
    const fiveMinAgoFloor = new Date(Math.floor((now - 5 * 60_000) / 60_000) * 60_000);
    await seedJob({
      status: 'completed',
      startedAt: new Date(tenMinAgoFloor.getTime() - 5_000),
      completedAt: new Date(tenMinAgoFloor.getTime() + 1_000),
    });
    await seedJob({
      status: 'completed',
      startedAt: new Date(tenMinAgoFloor.getTime() - 2_000),
      completedAt: new Date(tenMinAgoFloor.getTime() + 30_000),
    });
    await seedJob({
      status: 'completed',
      startedAt: new Date(fiveMinAgoFloor.getTime() - 2_000),
      completedAt: new Date(fiveMinAgoFloor.getTime() + 5_000),
    });
    // Outside the window — must be excluded.
    await seedJob({
      status: 'completed',
      startedAt: new Date(now - 3 * 60 * 60_000 - 2_000),
      completedAt: new Date(now - 3 * 60 * 60_000),
    });
    // Failed job — must be excluded (throughput is completions only).
    await seedJob({
      status: 'failed',
      startedAt: new Date(now - 2 * 60_000 - 2_000),
      completedAt: new Date(now - 2 * 60_000),
    });

    const body = await get<ThroughputResponse>('jobs/stats/throughput', {
      bucket: 'minute',
      since: '1h',
    });

    expect(body.buckets.length).toBe(2);
    const totalCount = body.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(totalCount).toBe(3);
    // Buckets are ordered ascending by ts.
    for (let i = 1; i < body.buckets.length; i++) {
      expect(body.buckets[i]!.ts >= body.buckets[i - 1]!.ts).toBe(true);
    }
    // Each ts is truncated to minute (seconds=0).
    for (const b of body.buckets) {
      expect(new Date(b.ts).getUTCSeconds()).toBe(0);
      expect(new Date(b.ts).getUTCMilliseconds()).toBe(0);
    }
  });

  it('defaults to bucket=minute and since=1h', async () => {
    const body = await get<ThroughputResponse>('jobs/stats/throughput');
    expect(body).toHaveProperty('buckets');
    expect(Array.isArray(body.buckets)).toBe(true);
  });
});

describe('GET /jobs/stats/durations', () => {
  it('returns avg, p50, p95 over completed jobs in the window', async () => {
    const now = Date.now();
    // Durations: 1000, 2000, 3000, 4000, 100000 ms — mix to make p95 ≠ p50.
    const durations = [1000, 2000, 3000, 4000, 100_000];
    for (const ms of durations) {
      const completedAt = new Date(now - 60_000);
      const startedAt = new Date(completedAt.getTime() - ms);
      await seedJob({ status: 'completed', startedAt, completedAt });
    }
    // Failed jobs in the window — excluded from duration math.
    await seedJob({
      status: 'failed',
      startedAt: new Date(now - 60_000 - 50),
      completedAt: new Date(now - 60_000),
    });

    const body = await get<DurationsResponse>('jobs/stats/durations', { since: '24h' });
    expect(body.total).toBe(5);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(body.avgMs).toBe(Math.round(avg));
    expect(body.p50Ms).toBe(3000);
    // p95 with 5 samples (NIST type 7): pos=4*0.95=3.8, => sorted[3]*0.2 + sorted[4]*0.8 = 4000*0.2 + 100000*0.8 = 80800
    expect(body.p95Ms).toBe(80_800);
  });

  it('returns zeros when no completed jobs in window', async () => {
    const body = await get<DurationsResponse>('jobs/stats/durations', { since: '15m' });
    expect(body).toEqual({ avgMs: 0, p50Ms: 0, p95Ms: 0, total: 0 });
  });
});

describe('GET /jobs/stats/error-rate', () => {
  it('returns failed / (failed + completed) over the window', async () => {
    const now = Date.now();
    const inWindow = new Date(now - 60_000);
    for (let i = 0; i < 8; i++) {
      await seedJob({ status: 'completed', startedAt: inWindow, completedAt: inWindow });
    }
    for (let i = 0; i < 2; i++) {
      await seedJob({
        status: 'failed',
        startedAt: inWindow,
        completedAt: inWindow,
        error: 'boom',
      });
    }
    // Outside the window — excluded.
    await seedJob({
      status: 'failed',
      startedAt: new Date(now - 2 * 24 * 3600_000),
      completedAt: new Date(now - 2 * 24 * 3600_000),
    });
    // Cancelled — excluded from both numerator and denominator.
    await seedJob({
      status: 'cancelled',
      startedAt: inWindow,
      completedAt: inWindow,
    });

    const body = await get<ErrorRateResponse>('jobs/stats/error-rate', { since: '24h' });
    expect(body.totalCompleted).toBe(8);
    expect(body.totalFailed).toBe(2);
    expect(body.rate).toBeCloseTo(0.2, 5);
  });

  it('returns rate=0 when window is empty', async () => {
    const body = await get<ErrorRateResponse>('jobs/stats/error-rate', { since: '15m' });
    expect(body).toEqual({ totalCompleted: 0, totalFailed: 0, rate: 0 });
  });
});

describe('GET /jobs/stats/* — input validation', () => {
  it('rejects invalid since value', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/jobs/stats/durations')
      .query({ since: '999d' })
      .set('Cookie', cookie)
      .expect(400);
  });

  it('rejects invalid bucket value', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/jobs/stats/throughput')
      .query({ bucket: 'second' })
      .set('Cookie', cookie)
      .expect(400);
  });
});
