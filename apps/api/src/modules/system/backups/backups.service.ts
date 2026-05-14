import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { publishEvent } from '@mnela/queue';
import { create as tarCreate, extract as tarExtract, list as tarList } from 'tar';
import { randomBytes } from 'node:crypto';

import { backupsDir, loadEnv, resolvedDataDir } from '../../../env.js';
import { RedisService } from '../../../redis.service.js';

const BACKUP_LOCK_KEY = 'mnela:backup:lock';
const BACKUP_LOCK_TTL_SECONDS = 60 * 30; // 30 min — long enough for a multi-GB vault

export interface BackupSummary {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  manifest: BackupManifest | null;
}

export interface BackupManifest {
  mnela_backup_version: number;
  created_at_utc: string;
  postgres_user: string;
  postgres_db: string;
  compose_project_name?: string;
  source?: 'ui' | 'cli';
  includes: {
    postgres: boolean;
    data_volume: boolean;
    claude_creds: boolean;
  };
}

export interface BackupRunStatus {
  running: boolean;
  jobId?: string;
  stage?: string;
  startedAt?: string;
}

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private active: { jobId: string; stage: string; startedAt: string } | null = null;

  constructor(private readonly redis: RedisService) {}

  /**
   * Resolved path where bundles live. Created on demand — first list/run
   * call materialises it.
   */
  private async ensureDir(): Promise<string> {
    const dir = backupsDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async listBackups(): Promise<BackupSummary[]> {
    const dir = await this.ensureDir();
    const entries = await readdir(dir, { withFileTypes: true });
    const out: BackupSummary[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.tar.gz')) continue;
      const full = path.join(dir, e.name);
      const st = await stat(full);
      const manifest = await this.readManifest(full).catch(() => null);
      out.push({
        filename: e.name,
        sizeBytes: st.size,
        createdAt: st.ctime.toISOString(),
        manifest,
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  async runningStatus(): Promise<BackupRunStatus> {
    if (this.active) {
      return { running: true, ...this.active };
    }
    const locked = await this.redis.client.get(BACKUP_LOCK_KEY);
    return { running: locked !== null };
  }

  /**
   * Stream a bundle from disk for download. Path-traversal-safe — the
   * filename param is restricted to the basename we manage.
   */
  async openBackup(
    filename: string,
  ): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number }> {
    const dir = await this.ensureDir();
    const safe = sanitizeFilename(filename);
    const full = path.join(dir, safe);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) throw new NotFoundException(`backup not found: ${safe}`);
    return { stream: createReadStream(full), sizeBytes: st.size };
  }

  async deleteBackup(filename: string): Promise<void> {
    const dir = await this.ensureDir();
    const safe = sanitizeFilename(filename);
    const full = path.join(dir, safe);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) throw new NotFoundException(`backup not found: ${safe}`);
    await unlink(full);
    this.logger.log(`deleted backup: ${safe}`);
  }

  /**
   * Acquires the lock + spawns the backup pipeline. Returns immediately
   * with the assigned jobId; live progress arrives via `backup.*` events
   * on the Socket.io /live namespace.
   */
  async start(): Promise<{ jobId: string }> {
    const env = loadEnv();
    const dir = await this.ensureDir();
    const jobId = `bk_${randomBytes(8).toString('hex')}`;

    // Redis SET NX to ensure only one backup runs at a time across api
    // replicas / restarts. TTL > worst-case backup duration.
    const acquired = await this.redis.client.set(
      BACKUP_LOCK_KEY,
      jobId,
      'EX',
      BACKUP_LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new ConflictException('Another backup is already running.');
    }

    const startedAt = new Date().toISOString();
    this.active = { jobId, stage: 'starting', startedAt };
    await publishEvent(this.redis.client, {
      type: 'backup.started',
      payload: { jobId, startedAt },
    });

    // Fire-and-forget — controller returns 202 immediately.
    void this.runPipeline(jobId, dir, env).catch((err) => {
      this.logger.error(
        `backup ${jobId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { jobId };
  }

  private async runPipeline(
    jobId: string,
    backupsRoot: string,
    env: ReturnType<typeof loadEnv>,
  ): Promise<void> {
    const t0 = Date.now();
    const work = await mkdtemp(path.join(tmpdir(), 'mnela-backup-'));
    const filename = `mnela-${timestamp()}.tar.gz`;
    const out = path.join(backupsRoot, filename);
    const dataDir = resolvedDataDir(env);

    try {
      // 1. pg_dump → work/postgres.sql.gz
      await this.setStage(jobId, 'pg_dump', 'Dumping PostgreSQL');
      await runPgDump(env.DATABASE_URL, path.join(work, 'postgres.sql.gz'));

      // 2. tar data dir → work/data.tar
      await this.setStage(jobId, 'tar_data', 'Archiving data volume');
      const hasKeystore = await this.tarDirectory(dataDir, path.join(work, 'data.tar'));

      // 3. claude creds (best-effort)
      await this.setStage(jobId, 'tar_claude', 'Archiving Claude credentials (best-effort)');
      const claudeRoot = '/claude-creds';
      const hasClaude = await fileExists(claudeRoot);
      if (hasClaude) {
        await this.tarDirectory(claudeRoot, path.join(work, 'claude-creds.tar'));
      }

      // 4. manifest.json
      const manifest: BackupManifest = {
        mnela_backup_version: 1,
        created_at_utc: new Date().toISOString(),
        postgres_user: parsePgUser(env.DATABASE_URL) ?? 'mnela',
        postgres_db: parsePgDb(env.DATABASE_URL) ?? 'mnela',
        source: 'ui',
        includes: {
          postgres: true,
          data_volume: true,
          claude_creds: hasClaude,
        },
      };
      await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));

      if (!hasKeystore) {
        this.logger.warn(
          `backup ${jobId}: keystore/provider.key not present in /data — MNELA_PROVIDER_SECRET likely set via env. Replicate it on the restore target.`,
        );
      }

      // 5. final tar -czf
      await this.setStage(jobId, 'tar_bundle', 'Bundling .tar.gz');
      await tarCreate(
        {
          gzip: true,
          file: out,
          cwd: work,
        },
        await listWorkContents(work),
      );

      const st = await stat(out);
      const durationMs = Date.now() - t0;
      this.logger.log(`backup ${jobId} done in ${durationMs}ms → ${out} (${st.size} bytes)`);
      await publishEvent(this.redis.client, {
        type: 'backup.done',
        payload: { jobId, filename, sizeBytes: st.size, durationMs },
      });
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      await publishEvent(this.redis.client, {
        type: 'backup.failed',
        payload: { jobId, error: message, durationMs },
      }).catch(() => undefined);
      // Best-effort cleanup of half-written .tar.gz.
      await unlink(out).catch(() => undefined);
      throw err;
    } finally {
      this.active = null;
      await this.redis.client.del(BACKUP_LOCK_KEY).catch(() => undefined);
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async setStage(jobId: string, stage: string, label: string): Promise<void> {
    if (this.active) this.active = { ...this.active, stage };
    await publishEvent(this.redis.client, {
      type: 'backup.progress',
      payload: {
        jobId,
        stage: stage as 'pg_dump' | 'tar_data' | 'tar_claude' | 'tar_bundle',
        label,
      },
    });
  }

  /**
   * Tars a directory into the given out file using the `tar` npm package
   * (pure Node, no shell-out). Returns whether `keystore/provider.key`
   * was included — used by the manifest + the install warning.
   */
  private async tarDirectory(dir: string, outFile: string): Promise<boolean> {
    const dirExists = await fileExists(dir);
    if (!dirExists) {
      // Create an empty tar so the bundle is consistent — restore copes.
      await writeFile(outFile, Buffer.alloc(1024));
      return false;
    }
    await tarCreate({ file: outFile, cwd: dir }, ['.']);
    let hasKeystore = false;
    await tarList({
      file: outFile,
      onentry: (e) => {
        if (e.path === 'keystore/provider.key' || e.path === './keystore/provider.key') {
          hasKeystore = true;
        }
      },
    });
    return hasKeystore;
  }

  private async readManifest(bundlePath: string): Promise<BackupManifest | null> {
    // Extract just manifest.json to a temp dir, parse, throw away.
    const work = await mkdtemp(path.join(tmpdir(), 'mnela-mf-'));
    try {
      await tarExtract({ file: bundlePath, cwd: work }, ['manifest.json']);
      const raw = await readFile(path.join(work, 'manifest.json'), 'utf8');
      return JSON.parse(raw) as BackupManifest;
    } catch {
      return null;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function sanitizeFilename(name: string): string {
  if (!/^mnela-[\w-]+\.tar\.gz$/.test(name)) {
    throw new BadRequestException(`invalid backup filename: ${name}`);
  }
  return name;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

function parsePgUser(url: string): string | null {
  try {
    return new URL(url).username || null;
  } catch {
    return null;
  }
}

function parsePgDb(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

async function listWorkContents(work: string): Promise<string[]> {
  const entries = await readdir(work);
  return entries;
}

/**
 * Spawns `pg_dump` and pipes its stdout through gzip into `outPath`.
 *
 * In the prod api image (`infra/docker/Dockerfile.api`) the binary lives
 * at /usr/bin/pg_dump (we apt-install postgresql-client). In dev on a
 * host without postgresql-client the first spawn ENOENT's; we fall
 * back to `docker compose exec mnela-postgres pg_dump …` so the UI
 * Backups button "just works" with the standard `pnpm dev` setup.
 *
 * Password never appears in argv — passed via PG* env to the child.
 */
async function runPgDump(databaseUrl: string, outPath: string): Promise<void> {
  const url = new URL(databaseUrl);
  const pgEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
  };

  const pgArgs = ['--no-owner', '--no-privileges', '--clean', '--if-exists'];

  // Attempt 1: native pg_dump (prod image / host with postgresql-client).
  try {
    await streamProcessToGzip(
      spawn('pg_dump', pgArgs, { env: pgEnv, stdio: ['ignore', 'pipe', 'pipe'] }),
      outPath,
    );
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  // Attempt 2: docker compose exec mnela-postgres pg_dump. Dev fallback.
  const dbName = url.pathname.replace(/^\//, '');
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const dockerProc = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${password}`,
      'mnela-postgres',
      'pg_dump',
      '-U',
      user,
      '-d',
      dbName,
      ...pgArgs,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await streamProcessToGzip(dockerProc, outPath);
}

async function streamProcessToGzip(
  proc: import('node:child_process').ChildProcess,
  outPath: string,
): Promise<void> {
  if (!proc.stdout || !proc.stderr) {
    throw new Error('child process spawned without stdout/stderr pipes');
  }
  const stderrChunks: Buffer[] = [];
  proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
  const out = createWriteStream(outPath);
  const gz = createGzip({ level: 9 });
  const piped = pipeline(proc.stdout, gz, out);
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const err = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
        reject(new Error(`pg_dump exited with code ${code}: ${err}`));
      }
    });
  });
  await Promise.all([piped, done]);
}
