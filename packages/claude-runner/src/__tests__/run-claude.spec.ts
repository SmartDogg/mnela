import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { runClaude } = await import('../run-claude.js');

class FakeChild extends EventEmitter {
  stdout = new Readable({ read: () => undefined });
  stderr = new Readable({ read: () => undefined });
  killed = false;
  killSignal?: string;
  kill(signal: string): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }
  pushStdout(chunk: string): void {
    this.stdout.push(chunk);
  }
  pushStderr(chunk: string): void {
    this.stderr.push(chunk);
  }
  async finish(code: number | null, signal: NodeJS.Signals | null = null): Promise<void> {
    this.stdout.push(null);
    this.stderr.push(null);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.emit('close', code, signal);
  }
  errorOut(err: Error): void {
    setImmediate(() => this.emit('error', err));
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe('runClaude', () => {
  it('passes the documented flags and forces CLAUDE_CODE_MAX_RETRIES=0', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);

    const promise = runClaude({
      prompt: 'enrich doc 1',
      mcpConfig: '/etc/mnela/claude-mcp-config.json',
      addDirs: ['/var/lib/mnela/vault'],
      bin: 'claude',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0];
    if (!call) throw new Error('spawn not called');
    const [bin, args, options] = call as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(bin).toBe('claude');
    expect(args).toEqual([
      '-p',
      'enrich doc 1',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config',
      '/etc/mnela/claude-mcp-config.json',
      '--add-dir',
      '/var/lib/mnela/vault',
      '--dangerously-skip-permissions',
    ]);
    expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe('0');

    child.pushStdout('{"type":"system","subtype":"init"}\n');
    child.pushStdout('{"type":"result","session_id":"s","result":"ok"}\n');
    await child.finish(0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.frames.map((f) => f.type)).toEqual(['system', 'result']);
    expect(result.result?.result).toBe('ok');
    expect(result.rateLimitHit).toBeNull();
    expect(result.authError).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('detects a rate-limit hit from an api_retry frame', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);

    const promise = runClaude({ prompt: 'x' });
    child.pushStdout(
      '{"type":"system","subtype":"api_retry","error":"rate_limit","error_status":429,"attempt":1,"max_retries":0,"retry_delay_ms":0}\n',
    );
    child.pushStdout(
      '{"type":"result","session_id":"s","result":"You\'ve hit your session limit · resets 3:45pm","is_error":true}\n',
    );
    await child.finish(1);

    const result = await promise;
    expect(result.rateLimitHit).not.toBeNull();
    expect(result.rateLimitHit?.resetAt).not.toBeNull();
  });

  it('marks timedOut and SIGTERMs the child past timeoutMs', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);

    const promise = runClaude({ prompt: 'x', timeoutMs: 50 });
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(child.killed).toBe(true);
    await child.finish(null, 'SIGTERM');

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGTERM');
  });

  it('rejects when the binary cannot be spawned', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);

    const promise = runClaude({ prompt: 'x', bin: 'nonexistent' });
    child.errorOut(new Error('ENOENT'));

    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('honors AbortSignal', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);

    const ctrl = new AbortController();
    const promise = runClaude({ prompt: 'x', signal: ctrl.signal });
    ctrl.abort();
    expect(child.killed).toBe(true);
    await child.finish(null, 'SIGTERM');
    const result = await promise;
    expect(result.signal).toBe('SIGTERM');
  });
});
