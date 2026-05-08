import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthTokenRepository, PrismaService } from '@mnela/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetEnvCache } from '../src/env.js';

let app: INestApplication;
let prisma: PrismaService;
let tokens: AuthTokenRepository;

interface IssuedToken {
  id: string;
  plaintext: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function issueToken(
  scope: 'admin' | 'mcp' | 'read_only',
  name: string,
): Promise<IssuedToken> {
  const plaintext = `mn_${randomBytes(24).toString('base64url')}`;
  const created = await tokens.create({
    name: `${name}-${Date.now()}`,
    tokenHash: sha256Hex(plaintext),
    scope,
  });
  return { id: created.id, plaintext };
}

interface JsonRpcMessage {
  result?: {
    content?: { type: string; text: string }[];
    isError?: boolean;
    tools?: { name: string }[];
    structuredContent?: unknown;
  };
  error?: { code: number; message: string };
  id?: number;
}

function parseSseFrame(body: string): JsonRpcMessage {
  const dataLine = body.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`no data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data: '.length)) as JsonRpcMessage;
}

beforeAll(async () => {
  resetEnvCache();
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

describe('Streamable HTTP transport on POST /mcp', () => {
  it('lists every registered tool through tools/list', async () => {
    const { plaintext } = await issueToken('admin', 'list-tools');

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

    expect(res.status).toBe(200);
    const message = parseSseFrame(res.text);
    const names = (message.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toContain('mnela_search');
    expect(names).toContain('mnela_save_note');
    expect(names).toContain('mnela_trigger_enrichment');
    expect(names).toHaveLength(20);
  });

  it('executes a read-only tool (mnela_list_projects) for any scope', async () => {
    const { plaintext } = await issueToken('read_only', 'read-list-projects');

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: { name: 'mnela_list_projects', arguments: {} },
      });

    expect(res.status).toBe(200);
    const message = parseSseFrame(res.text);
    expect(message.result?.isError).not.toBe(true);
    expect(message.result?.structuredContent).toMatchObject({ projects: expect.any(Array) });
  });

  it('writes the document and a same-tx AuditLog row on mnela_save_note', async () => {
    const issued = await issueToken('mcp', 'write-save-note');

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${issued.plaintext}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'mnela_save_note',
          arguments: { content: 'Phase 6 transport test note' },
        },
      });

    expect(res.status).toBe(200);
    const message = parseSseFrame(res.text);
    const structured = message.result?.structuredContent as { documentId: string };
    expect(structured?.documentId).toMatch(/^c[a-z0-9]{20,}$/);

    const doc = await prisma.client.document.findUnique({ where: { id: structured.documentId } });
    expect(doc?.rawText).toBe('Phase 6 transport test note');

    const auditRow = await prisma.client.auditLog.findFirst({
      where: { targetId: structured.documentId, action: 'mcp.save_note' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actor).toMatch(/^token:write-save-note-/);
    expect(auditRow?.targetType).toBe('Document');

    await prisma.client.auditLog.deleteMany({ where: { targetId: structured.documentId } });
    await prisma.client.document.delete({ where: { id: structured.documentId } });
    await prisma.client.authToken.delete({ where: { id: issued.id } });
  });

  it('rejects scope-insufficient tool calls with an MCP-level error and no audit row', async () => {
    const { plaintext, id } = await issueToken('read_only', 'denied-write');

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: { name: 'mnela_save_note', arguments: { content: 'should be denied' } },
      });

    expect(res.status).toBe(200);
    const message = parseSseFrame(res.text);
    expect(message.result?.isError).toBe(true);
    expect(message.result?.content?.[0]?.text).toMatch(/scope insufficient/);

    const auditCount = await prisma.client.auditLog.count({
      where: { action: 'mcp.save_note' },
    });
    // Other tests in this suite may have produced rows; the assertion is just
    // that the denied attempt itself didn't create one. We re-fetch by actor.
    void auditCount;

    const deniedAudit = await prisma.client.auditLog.findFirst({
      where: { actor: { startsWith: 'token:denied-write-' } },
    });
    expect(deniedAudit).toBeNull();

    await prisma.client.authToken.delete({ where: { id } });
  });

  it('enqueues a job via mnela_trigger_enrichment for admin scope', async () => {
    const target = await prisma.client.document.create({
      data: {
        source: 'manual_upload',
        title: 'enrichment target',
        rawText: 'body',
        contentHash: `enrich-${Date.now()}`,
        status: 'parsed',
      },
    });

    const { plaintext, id } = await issueToken('admin', 'admin-enrich');

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${plaintext}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'mnela_trigger_enrichment',
          arguments: { documentId: target.id },
        },
      });

    expect(res.status).toBe(200);
    const message = parseSseFrame(res.text);
    const structured = message.result?.structuredContent as { jobId: string };
    expect(structured?.jobId).toMatch(/^c[a-z0-9]{20,}$/);

    const job = await prisma.client.job.findUnique({ where: { id: structured.jobId } });
    expect(job?.type).toBe('enrich_document');

    const auditRow = await prisma.client.auditLog.findFirst({
      where: { action: 'mcp.trigger_enrichment', targetId: target.id },
    });
    expect(auditRow).not.toBeNull();

    await prisma.client.auditLog.deleteMany({ where: { targetId: target.id } });
    if (job) await prisma.client.job.delete({ where: { id: job.id } });
    await prisma.client.document.delete({ where: { id: target.id } });
    await prisma.client.authToken.delete({ where: { id } });
  });
});
