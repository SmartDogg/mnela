import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Minimal HTTP client for whisper.cpp `examples/server` binary.
 *
 * Wire contract (whisper.cpp server, current upstream as of 2026):
 *   GET  /          → text "OK" or simple HTML status page (used as healthcheck)
 *   POST /inference → multipart/form-data { file, language?, response_format=json }
 *                     returns { text, language, segments?, ... }
 *
 * Errors classify into `WhisperError` reasons so the caller can decide whether
 * to retry, mark whisper down, or surface to the operator.
 */

export type WhisperErrorReason =
  | 'network'
  | 'timeout'
  | 'http-status'
  | 'malformed-response'
  | 'file-not-found';

export class WhisperError extends Error {
  constructor(
    public readonly reason: WhisperErrorReason,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface WhisperTranscription {
  text: string;
  language: string;
  segments?: WhisperSegment[];
  durationSec?: number;
}

export interface WhisperHealth {
  ok: boolean;
  version?: string;
  model?: string;
}

export interface WhisperClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  /**
   * Optional fetch override for tests. Defaults to the global undici fetch on
   * Node 22+.
   */
  fetchImpl?: typeof fetch;
}

export interface TranscribeOptions {
  filePath: string;
  language: string;
}

export interface WhisperClient {
  health(): Promise<WhisperHealth>;
  transcribe(opts: TranscribeOptions): Promise<WhisperTranscription>;
}

export function createWhisperClient(opts: WhisperClientOptions): WhisperClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new WhisperError('timeout', `whisper request exceeded ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health(): Promise<WhisperHealth> {
      try {
        const res = await withTimeout((signal) =>
          fetchImpl(`${baseUrl}/`, { method: 'GET', signal }),
        );
        if (!res.ok) {
          return { ok: false };
        }
        const text = await res.text();
        // whisper.cpp server's index returns a small HTML page; we just need a
        // 2xx + reachable body. Pull a version hint from the body if present.
        const version = /whisper\.cpp\s+v([\w.-]+)/i.exec(text)?.[1];
        return version ? { ok: true, version } : { ok: true };
      } catch (err) {
        if (err instanceof WhisperError) throw err;
        return { ok: false };
      }
    },

    async transcribe(input: TranscribeOptions): Promise<WhisperTranscription> {
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(input.filePath);
      } catch {
        throw new WhisperError('file-not-found', `audio file missing: ${input.filePath}`);
      }
      if (!stat.isFile() || stat.size === 0) {
        throw new WhisperError(
          'file-not-found',
          `audio file empty or not a file: ${input.filePath}`,
        );
      }

      // Read the whole file into a Buffer — voice memos are typically < 50 MB
      // and the multipart helper in undici-fetch streams it from there. Keeps
      // the body deterministic for retry semantics.
      const bytes = await fs.readFile(input.filePath);
      const form = new FormData();
      form.append('file', new Blob([bytes]), path.basename(input.filePath));
      form.append('language', input.language);
      form.append('response_format', 'json');

      const res = await withTimeout((signal) =>
        fetchImpl(`${baseUrl}/inference`, { method: 'POST', body: form, signal }),
      );
      if (!res.ok) {
        throw new WhisperError(
          'http-status',
          `whisper /inference returned ${res.status}`,
          res.status,
        );
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new WhisperError('malformed-response', 'whisper /inference returned non-JSON body');
      }
      return normalizeTranscription(json);
    },
  };
}

function normalizeTranscription(raw: unknown): WhisperTranscription {
  if (!raw || typeof raw !== 'object') {
    throw new WhisperError('malformed-response', 'whisper response is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) {
    throw new WhisperError('malformed-response', 'whisper response lacks .text');
  }
  const language =
    typeof obj.language === 'string' && obj.language.length > 0
      ? obj.language
      : typeof obj.detected_language === 'string'
        ? obj.detected_language
        : 'unknown';

  const segments = Array.isArray(obj.segments)
    ? obj.segments
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map<WhisperSegment | null>((s) => {
          const start = typeof s.start === 'number' ? s.start : undefined;
          const end = typeof s.end === 'number' ? s.end : undefined;
          const segText = typeof s.text === 'string' ? s.text : undefined;
          if (start === undefined || end === undefined || segText === undefined) return null;
          return { start, end, text: segText };
        })
        .filter((s): s is WhisperSegment => s !== null)
    : undefined;

  const lastSegment = segments && segments.length > 0 ? segments[segments.length - 1] : undefined;
  const durationSec =
    typeof obj.duration === 'number' ? obj.duration : lastSegment ? lastSegment.end : undefined;

  const result: WhisperTranscription = { text, language };
  if (segments && segments.length > 0) result.segments = segments;
  if (durationSec !== undefined) result.durationSec = durationSec;
  return result;
}
