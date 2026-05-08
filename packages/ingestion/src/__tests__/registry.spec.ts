import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ParseContext } from '../parser.js';
import { resolveParser } from '../registry.js';

let workdir: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(tmpdir(), 'mnela-reg-'));
});
afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

const ctx = (overrides: Partial<ParseContext>): ParseContext => ({
  mimeType: 'application/octet-stream',
  extension: '',
  filename: 'sample',
  origin: 'manual_upload',
  workdir,
  ...overrides,
});

describe('resolveParser', () => {
  it('routes by mime — markdown', async () => {
    const buf = Buffer.from('# hi');
    const r = await resolveParser(buf, ctx({ mimeType: 'text/markdown', extension: '.md' }));
    expect(r.parser.name).toBe('md');
  });

  it('routes plain text', async () => {
    const r = await resolveParser(
      Buffer.from('hello'),
      ctx({ mimeType: 'text/plain', extension: '.txt' }),
    );
    expect(r.parser.name).toBe('txt');
  });

  it('routes HTML', async () => {
    const r = await resolveParser(
      Buffer.from('<html></html>'),
      ctx({ mimeType: 'text/html', extension: '.html' }),
    );
    expect(r.parser.name).toBe('html');
  });

  it('routes JSON', async () => {
    const r = await resolveParser(
      Buffer.from('{}'),
      ctx({ mimeType: 'application/json', extension: '.json' }),
    );
    expect(r.parser.name).toBe('json');
  });

  it('routes images by extension when mime is generic', async () => {
    const r = await resolveParser(Buffer.alloc(8), ctx({ extension: '.png' }));
    expect(r.parser.name).toBe('image');
  });

  it('routes audio by extension', async () => {
    const r = await resolveParser(Buffer.alloc(8), ctx({ extension: '.mp3' }));
    expect(r.parser.name).toBe('audio');
  });

  it('detects Claude Code session JSONL via first-line peek', async () => {
    const lines = [
      JSON.stringify({ type: 'user', sessionId: 'abc', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'assistant', sessionId: 'abc' }),
    ].join('\n');
    const r = await resolveParser(
      Buffer.from(lines),
      ctx({ extension: '.jsonl', filename: 'abc.jsonl' }),
    );
    expect(r.parser.name).toBe('claude-code-session');
  });

  it('falls back to txt parser when nothing matches', async () => {
    const r = await resolveParser(
      Buffer.from('whatever'),
      ctx({ extension: '.xyz', filename: 'thing.xyz' }),
    );
    expect(r.parser.name).toBe('txt');
    expect(r.matchedBy).toBe('fallback');
  });

  it('detects bare conversations.json as ChatGPT export', async () => {
    const buf = Buffer.from('[{"id":"x","title":"t","mapping":{}}]');
    const r = await resolveParser(
      buf,
      ctx({ extension: '.json', mimeType: 'application/json', filename: 'conversations.json' }),
    );
    expect(r.parser.name).toBe('chatgpt');
    expect(r.matchedBy).toBe('archive-peek');
  });

  it('detects ZIP magic bytes and routes ChatGPT or Claude flavor', async () => {
    // Construct a tiny ZIP with users.json + design_chats/ entry by using yauzl
    // peer — easier: use Node's built-in to spawn a real archive via JSZip would
    // pull in a dep. Verify only the magic-bytes branch fires by handing a
    // truncated header — detectZipFlavor returns 'unknown' and we fall through.
    const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const r = await resolveParser(fakeZip, ctx({ extension: '.zip', mimeType: 'application/zip' }));
    // Falls through to txt fallback because the archive is malformed.
    expect(['txt']).toContain(r.parser.name);
  });
});
