import { spawn } from 'node:child_process';

const PROBE_TIMEOUT_MS = 15_000;

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

function spawnAndCollect(bin: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    const timer = setTimeout(() => {
      if (!settled) child.kill('SIGTERM');
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, spawnError: err });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

export async function claudeAvailable(bin = 'claude'): Promise<boolean> {
  const r = await spawnAndCollect(bin, ['--version']);
  return r.spawnError === undefined && r.exitCode === 0;
}

export interface ClaudeTestResult {
  ok: boolean;
  version?: string;
  loggedIn?: boolean;
  error?: string;
  latencyMs: number;
}

const VERSION_RE = /(\d+\.\d+\.\d+(?:[\w.+-]*))/;

export async function claudeTest(bin = 'claude'): Promise<ClaudeTestResult> {
  const start = Date.now();
  const versionRun = await spawnAndCollect(bin, ['--version']);

  if (versionRun.spawnError) {
    return {
      ok: false,
      error: `binary not found: ${versionRun.spawnError.message}`,
      latencyMs: Date.now() - start,
    };
  }
  if (versionRun.exitCode !== 0) {
    return {
      ok: false,
      error: `claude --version exited ${versionRun.exitCode}: ${versionRun.stderr.trim().slice(0, 200)}`,
      latencyMs: Date.now() - start,
    };
  }

  const versionMatch = VERSION_RE.exec(versionRun.stdout);
  const version = versionMatch ? versionMatch[1] : undefined;

  const authRun = await spawnAndCollect(bin, ['auth', 'status']);
  const loggedIn = authRun.spawnError === undefined && authRun.exitCode === 0;

  const result: ClaudeTestResult = {
    ok: loggedIn,
    loggedIn,
    latencyMs: Date.now() - start,
  };
  if (version) result.version = version;
  if (!loggedIn) {
    result.error = authRun.stderr.trim().slice(0, 200) || 'claude is installed but not logged in';
  }
  return result;
}
