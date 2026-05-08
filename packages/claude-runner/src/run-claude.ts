import { spawn } from 'node:child_process';

import { detectAuthError, detectRateLimit, pickResultFrame } from './detect.js';
import { parseSingleJson, parseStream } from './parse-frames.js';
import type { RunOptions, RunResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000;

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

export async function runClaude(opts: RunOptions): Promise<RunResult> {
  const bin = opts.bin ?? 'claude';
  const args = buildArgs(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fmt = opts.outputFormat ?? 'stream-json';

  // Mnela owns the retry loop (ADR-0026): force the CLI to surface failures
  // immediately instead of burning the user's quota on internal retries.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    CLAUDE_CODE_MAX_RETRIES: '0',
  };

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      env,
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);

      const frames = fmt === 'stream-json' ? parseStream(stdout) : parseSingleJson(stdout);
      const result = pickResultFrame(frames);
      const resultText = result?.result ?? '';
      const rateLimitHit = detectRateLimit(frames, resultText);
      const authError = detectAuthError(frames, resultText, stderr);

      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        frames,
        result,
        rateLimitHit,
        authError,
        timedOut,
      });
    });
  });
}
