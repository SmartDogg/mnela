import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhisperError, createWhisperClient } from '../whisper-client.js';

async function makeTempAudio(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-test-'));
  const file = path.join(dir, 'sample.wav');
  // Minimal RIFF/WAVE header (44 bytes) + a few PCM samples — enough for stat
  // to return non-zero size and for the multipart helper to read.
  const buf = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WAVE', 'ascii'),
    Buffer.alloc(32),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
  ]);
  await fs.writeFile(file, buf);
  return file;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('whisper-client', () => {
  let audioPath: string;

  beforeEach(async () => {
    audioPath = await makeTempAudio();
  });

  afterEach(async () => {
    await fs.rm(path.dirname(audioPath), { recursive: true, force: true });
  });

  describe('health()', () => {
    it('returns ok on a 2xx page response', async () => {
      const fetchImpl = vi.fn(async () => new Response('<html>OK</html>', { status: 200 }));
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const h = await client.health();
      expect(h).toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://w:8080/',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('extracts a version hint from the page body when present', async () => {
      const fetchImpl = vi.fn(
        async () => new Response('whisper.cpp v1.5.4 ready', { status: 200 }),
      );
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const h = await client.health();
      expect(h).toEqual({ ok: true, version: '1.5.4' });
    });

    it('returns ok=false on a non-2xx', async () => {
      const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const h = await client.health();
      expect(h.ok).toBe(false);
    });

    it('returns ok=false on a network error', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const h = await client.health();
      expect(h.ok).toBe(false);
    });
  });

  describe('transcribe()', () => {
    it('maps a successful whisper.cpp response to WhisperTranscription', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          text: '  Привет мир  ',
          language: 'ru',
          duration: 2.14,
          segments: [
            { start: 0, end: 1.2, text: 'Привет' },
            { start: 1.2, end: 2.14, text: ' мир' },
          ],
        }),
      );
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const out = await client.transcribe({ filePath: audioPath, language: 'ru' });
      expect(out).toEqual({
        text: 'Привет мир',
        language: 'ru',
        durationSec: 2.14,
        segments: [
          { start: 0, end: 1.2, text: 'Привет' },
          { start: 1.2, end: 2.14, text: ' мир' },
        ],
      });
      const call = fetchImpl.mock.calls[0];
      expect(call).toBeDefined();
      const [url, init] = call as unknown as [string, RequestInit];
      expect(url).toBe('http://w:8080/inference');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
    });

    it('falls back to detected_language and segment-derived duration', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          text: 'hello world',
          detected_language: 'en',
          segments: [{ start: 0, end: 1.5, text: 'hello world' }],
        }),
      );
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      const out = await client.transcribe({ filePath: audioPath, language: 'auto' });
      expect(out.language).toBe('en');
      expect(out.durationSec).toBe(1.5);
    });

    it('throws WhisperError(http-status) on a 5xx', async () => {
      const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      await expect(
        client.transcribe({ filePath: audioPath, language: 'ru' }),
      ).rejects.toMatchObject({ reason: 'http-status', statusCode: 503 });
    });

    it('throws WhisperError(malformed-response) when text is missing', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { language: 'ru' }));
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      await expect(
        client.transcribe({ filePath: audioPath, language: 'ru' }),
      ).rejects.toMatchObject({ reason: 'malformed-response' });
    });

    it('throws WhisperError(file-not-found) when the file path does not exist', async () => {
      const fetchImpl = vi.fn();
      const client = createWhisperClient({ baseUrl: 'http://w:8080', fetchImpl });
      await expect(
        client.transcribe({ filePath: '/nonexistent/path.wav', language: 'ru' }),
      ).rejects.toMatchObject({ reason: 'file-not-found' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('classifies an aborted request as timeout', async () => {
      const fetchImpl: typeof fetch = ((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as typeof fetch;
      const client = createWhisperClient({
        baseUrl: 'http://w:8080',
        fetchImpl,
        timeoutMs: 10,
      });
      const err = await client
        .transcribe({ filePath: audioPath, language: 'ru' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WhisperError);
      expect((err as WhisperError).reason).toBe('timeout');
    });
  });
});
