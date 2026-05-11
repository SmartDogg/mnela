import { spawn } from 'node:child_process';

import { parseFrame } from './parse-frames.js';
import type { ClaudeFrame, RunOptions, RunResult } from './types.js';
import { detectAuthError, detectRateLimit, pickResultFrame } from './detect.js';

const DEFAULT_TIMEOUT_MS = 600_000;

export interface StreamHandle {
  /**
   * NDJSON frames as they arrive on stdout. Iterating this iterable consumes
   * the stream; you may only iterate once.
   */
  frames: AsyncIterable<ClaudeFrame>;
  /**
   * Resolves once the subprocess closes. Provides aggregated frames + the
   * same shape `runClaude` returns for the non-streaming path.
   */
  finalize(): Promise<RunResult>;
  /**
   * Imperative abort (in addition to the AbortSignal in opts). Idempotent.
   */
  abort(): void;
}

function buildArgs(opts: RunOptions): string[] {
  const args = ['-p', opts.prompt];
  const fmt = opts.outputFormat ?? 'stream-json';
  args.push('--output-format', fmt);
  if (fmt === 'stream-json') {
    args.push('--verbose');
    args.push('--include-partial-messages');
  }
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
  for (const dir of opts.addDirs ?? []) args.push('--add-dir', dir);
  args.push('--dangerously-skip-permissions');
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

/**
 * Streaming companion to `runClaude` (ADR-0042). Emits parsed NDJSON frames
 * one-by-one as the CLI writes them so the API layer can fan them out over
 * SSE without waiting for subprocess close. The non-streaming `runClaude`
 * remains the preferred entry-point for enrichment which needs the full
 * result before doing anything.
 */
export function streamClaude(opts: RunOptions): StreamHandle {
  const bin = opts.bin ?? 'claude';
  const args = buildArgs(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fmt = opts.outputFormat ?? 'stream-json';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    CLAUDE_CODE_MAX_RETRIES: '0',
  };

  const child = spawn(bin, args, {
    env,
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let timedOut = false;
  const collectedFrames: ClaudeFrame[] = [];
  const frameQueue: ClaudeFrame[] = [];
  let frameResolver: ((value: ClaudeFrame | undefined) => void) | null = null;
  let streamEnded = false;
  let aborted = false;

  const onAbort = (): void => {
    if (aborted) return;
    aborted = true;
    child.kill('SIGTERM');
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, timeoutMs);

  function pushFrame(frame: ClaudeFrame): void {
    collectedFrames.push(frame);
    if (frameResolver) {
      const fn = frameResolver;
      frameResolver = null;
      fn(frame);
    } else {
      frameQueue.push(frame);
    }
  }

  function endStream(): void {
    if (streamEnded) return;
    streamEnded = true;
    if (frameResolver) {
      const fn = frameResolver;
      frameResolver = null;
      fn(undefined);
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      const frame = parseFrame(line);
      if (frame) pushFrame(frame);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8');
  });

  const closePromise = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      endStream();
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (stdoutBuf.length > 0) {
        const frame = parseFrame(stdoutBuf);
        if (frame) pushFrame(frame);
        stdoutBuf = '';
      }
      endStream();
      resolve({ exitCode: code, signal });
    });
  });

  const frames: AsyncIterable<ClaudeFrame> = {
    [Symbol.asyncIterator](): AsyncIterator<ClaudeFrame> {
      return {
        next(): Promise<IteratorResult<ClaudeFrame>> {
          const buffered = frameQueue.shift();
          if (buffered) return Promise.resolve({ value: buffered, done: false });
          if (streamEnded) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<ClaudeFrame>>((resolve) => {
            frameResolver = (frame) => {
              if (frame) resolve({ value: frame, done: false });
              else resolve({ value: undefined, done: true });
            };
          });
        },
      };
    },
  };

  async function finalize(): Promise<RunResult> {
    const { exitCode, signal } = await closePromise;
    if (fmt !== 'stream-json' && collectedFrames.length === 0 && stdoutBuf.trim().length > 0) {
      try {
        const obj = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
        if (typeof obj['type'] !== 'string') obj['type'] = 'result';
        collectedFrames.push(obj as unknown as ClaudeFrame);
      } catch {
        // Ignore — we'll surface stdout/stderr in the result.
      }
    }
    const result = pickResultFrame(collectedFrames);
    const resultText = result?.result ?? '';
    const rateLimitHit = detectRateLimit(collectedFrames, resultText);
    const authError = detectAuthError(collectedFrames, resultText, stderrBuf);
    return {
      exitCode,
      signal,
      stdout: '',
      stderr: stderrBuf,
      frames: collectedFrames,
      result,
      rateLimitHit,
      authError,
      timedOut,
    };
  }

  return {
    frames,
    finalize,
    abort: onAbort,
  };
}
