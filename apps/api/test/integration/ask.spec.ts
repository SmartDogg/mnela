/**
 * Phase 8 integration tests for /search/ask SSE endpoint, conversations, and
 * save-synthesis. Mocks `streamClaude` to feed scripted NDJSON frames so we
 * cover Dumb Mode fallback, citation parsing, rate-limit detection, and
 * persistence without a real Claude subprocess.
 */
import { type INestApplication } from '@nestjs/common';
import type { ClaudeFrame, RunResult } from '@mnela/claude-runner';
import type { Conversation, Document, Message } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeClaudeStatus } from '@mnela/queue';

interface ScriptedHandle {
  frames: AsyncIterable<ClaudeFrame>;
  finalize: () => Promise<RunResult>;
  abort: () => void;
}

const streamClaudeMock = vi.fn<(...args: unknown[]) => ScriptedHandle>();

vi.mock('@mnela/claude-runner', async () => {
  const real = await vi.importActual<typeof import('@mnela/claude-runner')>('@mnela/claude-runner');
  return {
    ...real,
    streamClaude: (...args: unknown[]) => streamClaudeMock(...args),
  };
});

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';
const VALID_DOC = 'c' + 'a'.repeat(24);

let app: INestApplication;
let prisma: import('@mnela/db').PrismaService;
let cookie: string;
let redis: import('@mnela/db').PrismaService extends never ? never : import('ioredis').Redis;

beforeAll(async () => {
  const { buildTestApp } = await import('../bootstrap.js');
  app = await buildTestApp();
  const { PrismaService } = await import('@mnela/db');
  prisma = app.get(PrismaService);
  const { RedisService } = await import('../../src/redis.service.js');
  redis = app.get(RedisService).client;

  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const setCookie = login.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no set-cookie header on login response');
  cookie = raw.split(';')[0]!;
  if (!cookie) throw new Error('empty cookie after split');
  // Sanity check that auth works end-to-end via a basic /auth/me call.
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
  if (me.status !== 200) {
    throw new Error(`auth/me sanity check failed (status=${me.status}, cookie="${cookie}")`);
  }
}, 240_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await prisma.client.message.deleteMany();
  await prisma.client.conversation.deleteMany();
  await prisma.client.auditLog.deleteMany();
  await prisma.client.documentEntity.deleteMany();
  await prisma.client.document.deleteMany();
  // Targeted Redis cleanup — DO NOT flush DB because the session cookie used by
  // every test in this file lives in Redis under mnela:session:<id>.
  const keys = await redis.keys('mnela:claude:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterEach(() => {
  streamClaudeMock.mockReset();
});

async function makeDocument(id: string, title: string, body: string): Promise<Document> {
  return prisma.client.document.create({
    data: {
      id,
      source: 'manual_upload',
      title,
      rawText: body,
      contentHash: id, // unique-enough in-test
      status: 'enriched',
    },
  });
}

function script(frames: ClaudeFrame[], result?: RunResult['result']): ScriptedHandle {
  let i = 0;
  const finalResult: RunResult['result'] = result ?? null;
  return {
    frames: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (i < frames.length) return Promise.resolve({ value: frames[i++]!, done: false });
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    },
    finalize: () =>
      Promise.resolve({
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        frames,
        result: finalResult,
        rateLimitHit: null,
        authError: null,
        timedOut: false,
      }),
    abort: () => undefined,
  };
}

function streamEvent(text: string): ClaudeFrame {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  } as unknown as ClaudeFrame;
}

async function postAskRaw(body: unknown): Promise<{ status: number; raw: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/search/ask')
    .set('Cookie', cookie)
    .set('Accept', 'text/event-stream')
    .send(body);
  return { status: res.status, raw: typeof res.text === 'string' ? res.text : String(res.body) };
}

function parseSse(raw: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of raw.split(/\n\n/)) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    try {
      out.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // Skip unparseable frames.
    }
  }
  return out;
}

describe('POST /search/ask (Phase 8)', () => {
  it('Dumb Mode fallback emits meta+token+done with FTS citations when Claude is unavailable', async () => {
    await writeClaudeStatus(redis, {
      available: false,
      reason: 'no-binary',
      checkedAt: new Date().toISOString(),
    });
    await makeDocument(VALID_DOC, 'Postgres FTS notes', 'pg_trgm + russian dictionary');

    const { status, raw } = await postAskRaw({ query: 'postgres fts' });
    expect(status).toBe(200);
    const frames = parseSse(raw);

    const meta = frames.find((f) => f.event === 'meta')!;
    expect((meta.data as { dumbMode: boolean }).dumbMode).toBe(true);
    expect(frames.find((f) => f.event === 'token')).toBeTruthy();
    expect(frames.find((f) => f.event === 'done')).toBeTruthy();
    expect(streamClaudeMock).not.toHaveBeenCalled();

    const conversations = await prisma.client.conversation.findMany();
    expect(conversations).toHaveLength(1);
    const messages = await prisma.client.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m: Message) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.dumbMode).toBe(true);
  });

  it('Smart Mode streams tokens, emits citations from inline <cite> tags, persists Message rows', async () => {
    await writeClaudeStatus(redis, { available: true, checkedAt: new Date().toISOString() });
    await makeDocument(VALID_DOC, 'Strict typing', 'use strict typing always');

    streamClaudeMock.mockReturnValue(
      script([
        streamEvent('You prefer '),
        streamEvent(`<cite doc-id="${VALID_DOC}">strict typing</cite>`),
        streamEvent(' across the stack.'),
      ]),
    );

    const { status, raw } = await postAskRaw({ query: 'what do I prefer?' });
    expect(status).toBe(200);
    const frames = parseSse(raw);
    expect(streamClaudeMock).toHaveBeenCalled();

    const tokens = frames
      .filter((f) => f.event === 'token')
      .map((f) => (f.data as { delta: string }).delta);
    const assembled = tokens.join('');
    expect(assembled, `streamed text was: ${JSON.stringify(assembled)}`).toContain('You prefer ');
    expect(assembled).toContain('[1]');
    expect(assembled).toContain(' across the stack.');

    const citations = frames.filter((f) => f.event === 'citation');
    expect(citations).toHaveLength(1);
    expect((citations[0]!.data as { docId: string; ord: number }).docId).toBe(VALID_DOC);
    expect((citations[0]!.data as { ord: number }).ord).toBe(1);

    expect(frames.find((f) => f.event === 'done')).toBeTruthy();

    const messages = await prisma.client.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages).toHaveLength(2);
    const assistant = messages[1]!;
    expect(assistant.role).toBe('assistant');
    expect(Array.isArray(assistant.citations)).toBe(true);
    expect((assistant.citations as unknown as { docId: string }[])[0]?.docId).toBe(VALID_DOC);

    const audit = await prisma.client.auditLog.findFirst({ where: { action: 'ask.completed' } });
    expect(audit).toBeTruthy();
  });

  it('emits error: rate-limit when Claude raises api_retry frame', async () => {
    await writeClaudeStatus(redis, { available: true, checkedAt: new Date().toISOString() });

    streamClaudeMock.mockReturnValue(
      script([
        {
          type: 'system',
          subtype: 'api_retry',
          error: 'rate_limit',
          error_status: 429,
          attempt: 1,
          max_retries: 0,
          retry_delay_ms: 0,
        } as unknown as ClaudeFrame,
      ]),
    );

    const { raw } = await postAskRaw({ query: 'anything' });
    const frames = parseSse(raw);
    const err = frames.find((f) => f.event === 'error');
    expect(err).toBeTruthy();
    expect((err!.data as { reason: string }).reason).toBe('rate-limit');
  });

  it('persists chunks-spanning <cite> tag correctly (state-machine invariant)', async () => {
    await writeClaudeStatus(redis, { available: true, checkedAt: new Date().toISOString() });
    await makeDocument(VALID_DOC, 'Doc', 'body');

    streamClaudeMock.mockReturnValue(
      script([
        streamEvent('start <ci'),
        streamEvent(`te doc-id="${VALID_DOC.slice(0, 10)}`),
        streamEvent(`${VALID_DOC.slice(10)}">a snippet</cite> end`),
      ]),
    );

    const { raw } = await postAskRaw({ query: 'cross-chunk tag' });
    const frames = parseSse(raw);
    const citation = frames.find((f) => f.event === 'citation');
    expect(citation).toBeTruthy();
    expect((citation!.data as { docId: string }).docId).toBe(VALID_DOC);
  });
});

describe('Conversation REST + save-synthesis', () => {
  it('GET /conversations lists by updatedAt desc and GET /conversations/:id returns messages', async () => {
    await writeClaudeStatus(redis, {
      available: false,
      reason: 'no-binary',
      checkedAt: new Date().toISOString(),
    });

    await postAskRaw({ query: 'first' });
    await postAskRaw({ query: 'second' });

    const list = await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body.items).toHaveLength(2);
    expect((list.body.items[0] as Conversation).title).toContain('second');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${(list.body.items[0] as Conversation).id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /search/ask/save creates a Document(type=synthesis) and links it to the conversation', async () => {
    await writeClaudeStatus(redis, {
      available: false,
      reason: 'no-binary',
      checkedAt: new Date().toISOString(),
    });

    const { raw } = await postAskRaw({ query: 'what about it' });
    const frames = parseSse(raw);
    const done = frames.find((f) => f.event === 'done')!;
    const { conversationId, messageId } = done.data as {
      conversationId: string;
      messageId: string;
    };

    const save = await request(app.getHttpServer())
      .post('/api/v1/search/ask/save')
      .set('Cookie', cookie)
      .send({ conversationId, messageId, title: 'My synthesis' })
      .expect(200);

    expect(save.body.documentId).toBeTruthy();
    const doc = await prisma.client.document.findUnique({
      where: { id: save.body.documentId },
    });
    expect(doc?.type).toBe('synthesis');
    expect(doc?.title).toBe('My synthesis');

    const conv = await prisma.client.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.synthesisDocumentId).toBe(save.body.documentId);

    const audit = await prisma.client.auditLog.findFirst({
      where: { action: 'ask.save_synthesis' },
    });
    expect(audit).toBeTruthy();
  });

  it('DELETE /conversations/:id cascades messages', async () => {
    await writeClaudeStatus(redis, {
      available: false,
      reason: 'no-binary',
      checkedAt: new Date().toISOString(),
    });

    const { raw } = await postAskRaw({ query: 'ephemeral' });
    const conversationId = (
      parseSse(raw).find((f) => f.event === 'meta')!.data as { conversationId: string }
    ).conversationId;

    await request(app.getHttpServer())
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('Cookie', cookie)
      .expect(200);

    const remaining = await prisma.client.message.count({ where: { conversationId } });
    expect(remaining).toBe(0);
  });
});
