import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { WHISPER_STATUS_KEY } from '@mnela/queue';
import type { Attachment, Document } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

let app: INestApplication;
let prisma: import('@mnela/db').PrismaService;
let redis: import('../../src/redis.service.js').RedisService;
let cookie: string;
let tempDir: string;

async function makeAudioDoc(
  filename = 'sample.wav',
  contents = Buffer.alloc(2048, 0xab),
): Promise<{ doc: Document; att: Attachment; path: string }> {
  await fs.mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `${Date.now()}-${filename}`);
  await fs.writeFile(filePath, contents);

  const doc = await prisma.client.document.create({
    data: {
      source: 'manual_upload',
      title: 'Voice memo',
      rawText: '',
      contentHash: `phase9-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      tokenCount: 0,
      type: 'audio',
      status: 'raw',
      metadata: { originalFilename: filename },
    },
  });
  const att = await prisma.client.attachment.create({
    data: {
      documentId: doc.id,
      filename,
      mimeType: 'audio/wav',
      size: contents.length,
      path: filePath,
      contentHash: `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  return { doc, att, path: filePath };
}

async function setWhisperAvailable(available: boolean): Promise<void> {
  const value = JSON.stringify({
    available,
    ...(available ? {} : { reason: 'not-enabled' }),
    checkedAt: new Date().toISOString(),
    model: 'base',
  });
  await redis.client.set(WHISPER_STATUS_KEY, value);
}

async function clearTestPrefixedKeys(): Promise<void> {
  // Memory rule: never FLUSHALL — sessions live in this DB too. Scope by prefix.
  for await (const keys of redis.client.scanStream({ match: 'mnela:whisper:*', count: 100 })) {
    if (keys.length > 0) await redis.client.del(keys as string[]);
  }
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnela-phase9-'));
  app = await buildTestApp();
  const { PrismaService } = await import('@mnela/db');
  prisma = app.get(PrismaService);
  const { RedisService } = await import('../../src/redis.service.js');
  redis = app.get(RedisService);

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
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

beforeEach(async () => {
  await prisma.client.auditLog.deleteMany();
  await prisma.client.documentChunk.deleteMany();
  await prisma.client.attachment.deleteMany();
  await prisma.client.job.deleteMany();
  await prisma.client.document.deleteMany();
  await clearTestPrefixedKeys();
});

describe('GET /system/whisper-status', () => {
  it('defaults to not-enabled when no key has been written', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/system/whisper-status')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ available: false, reason: 'not-enabled' });
  });

  it('reflects the value the worker boot probe writes', async () => {
    await setWhisperAvailable(true);
    const res = await request(app.getHttpServer())
      .get('/api/v1/system/whisper-status')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ available: true, model: 'base' });
  });
});

describe('POST /documents/:id/retranscribe', () => {
  it('returns 503 problem+json when whisper is unavailable', async () => {
    const { doc } = await makeAudioDoc();
    await setWhisperAvailable(false);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/retranscribe`)
      .set('Cookie', cookie)
      .expect(503);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ reason: 'not-enabled' });
  });

  it('returns 409 when the document is not audio', async () => {
    const doc = await prisma.client.document.create({
      data: {
        source: 'manual_upload',
        title: 'notes',
        rawText: 'hello',
        contentHash: `notaudio-${Date.now()}`,
        tokenCount: 1,
        type: 'note',
        status: 'parsed',
        metadata: {},
      },
    });
    await setWhisperAvailable(true);

    await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/retranscribe`)
      .set('Cookie', cookie)
      .expect(409);
  });

  it('202 + jobId when whisper available; creates Job(type=transcribe_audio) row', async () => {
    await setWhisperAvailable(true);
    const { doc } = await makeAudioDoc();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/retranscribe`)
      .set('Cookie', cookie)
      .expect(202);
    expect(res.body.jobId).toMatch(/^[a-z0-9]{20,}$/);

    const job = await prisma.client.job.findUnique({ where: { id: res.body.jobId } });
    expect(job).not.toBeNull();
    expect(job?.type).toBe('transcribe_audio');
    expect(job?.documentId).toBe(doc.id);
  });
});

describe('GET /documents/:id/attachment', () => {
  it('200 + full body when no Range header', async () => {
    const bytes = Buffer.from('mnela-phase9-audio-bytes'.repeat(20));
    const { doc } = await makeAudioDoc('full.wav', bytes);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/documents/${doc.id}/attachment`)
      .set('Cookie', cookie)
      .expect(200)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(Number(res.headers['content-length'])).toBe(bytes.length);
    expect((res.body as Buffer).length).toBe(bytes.length);
    expect((res.body as Buffer).equals(bytes)).toBe(true);
  });

  it('206 + partial body when Range bytes=START-END', async () => {
    const bytes = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(50));
    const { doc } = await makeAudioDoc('partial.wav', bytes);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/documents/${doc.id}/attachment`)
      .set('Cookie', cookie)
      .set('Range', 'bytes=10-49')
      .expect(206)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.headers['content-range']).toBe(`bytes 10-49/${bytes.length}`);
    expect(Number(res.headers['content-length'])).toBe(40);
    expect((res.body as Buffer).length).toBe(40);
    expect((res.body as Buffer).equals(bytes.subarray(10, 50))).toBe(true);
  });

  it('206 + suffix range for bytes=-N', async () => {
    const bytes = Buffer.from('0123456789'.repeat(20));
    const { doc } = await makeAudioDoc('suffix.wav', bytes);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/documents/${doc.id}/attachment`)
      .set('Cookie', cookie)
      .set('Range', 'bytes=-20')
      .expect(206)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(Number(res.headers['content-length'])).toBe(20);
    expect((res.body as Buffer).equals(bytes.subarray(bytes.length - 20))).toBe(true);
  });

  it('416 when Range start is out of bounds', async () => {
    const bytes = Buffer.from('short');
    const { doc } = await makeAudioDoc('416.wav', bytes);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/documents/${doc.id}/attachment`)
      .set('Cookie', cookie)
      .set('Range', 'bytes=9999-99999')
      .expect(416);
    expect(res.headers['content-range']).toBe(`bytes */${bytes.length}`);
  });
});

describe('POST /system/transcribe-pending', () => {
  it('admin scope required, enqueues one job per status=raw audio doc', async () => {
    await setWhisperAvailable(true);
    const a = await makeAudioDoc('a.wav');
    const b = await makeAudioDoc('b.wav');
    // Non-audio doc must be ignored.
    await prisma.client.document.create({
      data: {
        source: 'manual_upload',
        title: 'not audio',
        rawText: 'text',
        contentHash: `txt-${Date.now()}`,
        tokenCount: 1,
        type: 'note',
        status: 'parsed',
        metadata: {},
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/system/transcribe-pending')
      .set('Cookie', cookie)
      .expect(202);
    expect(res.body.enqueued).toBe(2);
    expect(res.body.jobIds).toHaveLength(2);

    const jobs = await prisma.client.job.findMany({
      where: { type: 'transcribe_audio' },
      orderBy: { createdAt: 'asc' },
    });
    const docIds = jobs.map((j) => j.documentId).sort();
    expect(docIds).toEqual([a.doc.id, b.doc.id].sort());
  });

  it('returns 503 when whisper unavailable', async () => {
    await setWhisperAvailable(false);
    await request(app.getHttpServer())
      .post('/api/v1/system/transcribe-pending')
      .set('Cookie', cookie)
      .expect(503);
  });
});
