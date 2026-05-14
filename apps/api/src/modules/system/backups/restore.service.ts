import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@mnela/db';
import { publishEvent } from '@mnela/queue';
import { extract as tarExtract } from 'tar';

import { backupsDir, loadEnv, resolvedDataDir } from '../../../env.js';
import { RedisService } from '../../../redis.service.js';
import type { BackupManifest } from './backups.service.js';
import { maintenanceHolder } from './maintenance.holder.js';

export interface RestoreValidationResult {
  valid: boolean;
  manifest: BackupManifest | null;
  keystoreMatches: boolean | 'no-rows';
  error?: string;
}

export interface RestoreLastResult {
  jobId: string;
  filename: string;
  status: 'running' | 'done' | 'failed';
  stage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);
  private last: RestoreLastResult | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Stand-alone validation. Pure read — no destructive ops, doesn't
   * even touch the DB. UI calls this in the confirm dialog so the
   * "restore" button stays disabled when the bundle is broken.
   */
  async validate(filename: string): Promise<RestoreValidationResult> {
    const dir = backupsDir();
    const safe = sanitizeFilename(filename);
    const full = path.join(dir, safe);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) {
      throw new NotFoundException(`backup not found: ${safe}`);
    }

    const work = await mkdtemp(path.join(tmpdir(), 'mnela-restore-validate-'));
    try {
      // Extract just manifest.json + (optionally) postgres dump head + claude/data tar checks.
      // We only need the manifest + the embedded keystore from data.tar to verify the key.
      await tarExtract({ file: full, cwd: work }, ['manifest.json', 'data.tar', 'postgres.sql.gz']);

      const manifestRaw = await readFile(path.join(work, 'manifest.json'), 'utf8').catch(
        () => null,
      );
      if (!manifestRaw) {
        return {
          valid: false,
          manifest: null,
          keystoreMatches: false,
          error: 'manifest.json missing',
        };
      }
      let manifest: BackupManifest;
      try {
        manifest = JSON.parse(manifestRaw) as BackupManifest;
      } catch (err) {
        return {
          valid: false,
          manifest: null,
          keystoreMatches: false,
          error: `manifest.json invalid JSON: ${(err as Error).message}`,
        };
      }

      // Extract data.tar to find keystore/provider.key.
      const dataExtract = path.join(work, 'data-x');
      await mkdir(dataExtract, { recursive: true });
      try {
        await tarExtract({
          file: path.join(work, 'data.tar'),
          cwd: dataExtract,
          // Best-effort; ignore tar warnings on weird Windows entries.
          onwarn: () => undefined,
        });
      } catch (err) {
        this.logger.warn(
          `validate: failed to extract data.tar from bundle: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const keyPath = path.join(dataExtract, 'keystore', 'provider.key');
      const keystoreMatches = await this.verifyKeystoreAgainstDump(
        keyPath,
        path.join(work, 'postgres.sql.gz'),
      );

      return { valid: true, manifest, keystoreMatches };
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Check whether the bundle's keystore decrypts at least one row of
   * LlmProvider.apiKeyEnc from the dump. Returns 'no-rows' if there's
   * nothing encrypted in the bundle (keystore unused — restore is safe).
   */
  private async verifyKeystoreAgainstDump(
    keyPath: string,
    dumpPath: string,
  ): Promise<boolean | 'no-rows'> {
    const keySt = await stat(keyPath).catch(() => null);
    if (!keySt || !keySt.isFile()) return false;
    const key = await readFile(keyPath);
    if (key.length !== 32) return false;

    // Read gzipped dump as text (multi-MB but typical vaults fit; for very
    // large dumps we could stream, but this is the same approach scripts/
    // validate-keystore.mjs uses successfully).
    const buf = await readFile(dumpPath);
    const text = (
      await new Promise<Buffer>((resolve, reject) => {
        const gz = createGunzip();
        const chunks: Buffer[] = [];
        gz.on('data', (c: Buffer) => chunks.push(c));
        gz.on('end', () => resolve(Buffer.concat(chunks)));
        gz.on('error', reject);
        gz.end(buf);
      })
    ).toString('utf8');

    const copyHeader = text.match(/COPY public\."LlmProvider" \(([^)]+)\) FROM stdin;/);
    if (!copyHeader || copyHeader.index === undefined) return 'no-rows';
    const headerCols = copyHeader[1];
    if (!headerCols) return false;
    const cols = headerCols.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const idx = cols.indexOf('apiKeyEnc');
    if (idx === -1) return false;

    const start = copyHeader.index + copyHeader[0].length;
    const tail = text.slice(start);
    const term = tail.search(/^\\\.$/m);
    const body = term === -1 ? tail : tail.slice(0, term);
    const rows = body.split('\n').filter((line) => line.length > 0);
    let hex: string | null = null;
    for (const r of rows) {
      const f = r.split('\t')[idx];
      if (!f || f === '\\N') continue;
      const m = f.match(/^\\x([0-9a-fA-F]+)$/);
      if (m && m[1]) {
        hex = m[1];
        break;
      }
    }
    if (!hex) return 'no-rows';

    const blob = Buffer.from(hex, 'hex');
    if (blob.length < 29) return false;
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    try {
      const dec = createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);
      const pt = Buffer.concat([dec.update(ct), dec.final()]);
      return pt.length > 0;
    } catch {
      return false;
    }
  }

  /** Last completed / running / failed restore in this api process. */
  getLastResult(): RestoreLastResult | null {
    return this.last;
  }

  async start(filename: string): Promise<{ jobId: string }> {
    if (maintenanceHolder.isActive) {
      throw new ConflictException('Another restore is already running.');
    }
    const dir = backupsDir();
    const safe = sanitizeFilename(filename);
    const full = path.join(dir, safe);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) throw new NotFoundException(`backup not found: ${safe}`);

    const jobId = `rs_${randomBytes(8).toString('hex')}`;
    const startedAt = new Date().toISOString();
    this.last = { jobId, filename: safe, status: 'running', startedAt, stage: 'starting' };
    maintenanceHolder.enter(`Restoring from ${safe}`);

    await publishEvent(this.redis.client, {
      type: 'backup.restore.started',
      payload: { jobId, filename: safe, startedAt },
    });

    void this.runPipeline(jobId, full, safe).catch((err) => {
      this.logger.error(
        `restore ${jobId} crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { jobId };
  }

  private async runPipeline(jobId: string, bundlePath: string, filename: string): Promise<void> {
    const t0 = Date.now();
    const env = loadEnv();
    const dataDir = resolvedDataDir(env);
    const work = await mkdtemp(path.join(tmpdir(), 'mnela-restore-'));

    try {
      // ---- 1. extract to work dir
      await this.setStage(jobId, 'validating', 'Extracting bundle');
      await tarExtract({ file: bundlePath, cwd: work });

      // ---- 2. drain other postgres connections
      await this.setStage(jobId, 'draining', 'Closing other database connections');
      await this.terminateOtherBackends(env.DATABASE_URL);

      // Close our own pool — psql will replace the schema underneath us.
      await this.prisma.client.$disconnect();

      // ---- 3. pg_restore via `psql` (plain .sql.gz format)
      await this.setStage(jobId, 'pg_restore', 'Restoring PostgreSQL');
      await runPsqlRestore(env.DATABASE_URL, path.join(work, 'postgres.sql.gz'));

      // ---- 4. wipe + untar /data
      await this.setStage(jobId, 'untar_data', 'Restoring /data volume');
      await clearDir(dataDir);
      await tarExtract({ file: path.join(work, 'data.tar'), cwd: dataDir });

      // claude-creds is optional; restore.sh did the same.
      const claudeDir = '/claude-creds';
      const claudeAvailable = await stat(claudeDir)
        .then(() => true)
        .catch(() => false);
      if (claudeAvailable && (await fileExists(path.join(work, 'claude-creds.tar')))) {
        await clearDir(claudeDir).catch(() => undefined);
        await tarExtract({ file: path.join(work, 'claude-creds.tar'), cwd: claudeDir }).catch(
          () => undefined,
        );
      }

      // ---- 5. apply migrations
      await this.setStage(jobId, 'migrate', 'Applying schema migrations');
      await runPrismaMigrate();

      // ---- 6. re-open prisma pool
      await this.setStage(jobId, 'reopen', 'Reconnecting database pool');
      await this.prisma.client.$connect();

      // ---- 7. signal workers / orchestrator to reset their BullMQ runners
      await this.setStage(jobId, 'reload', 'Reloading workers');
      const reloadRequestId = randomBytes(8).toString('hex');
      await publishEvent(this.redis.client, {
        type: 'system.service_reload',
        payload: { service: 'all', reason: `post-restore-${jobId}`, requestId: reloadRequestId },
      });

      const durationMs = Date.now() - t0;
      this.last = {
        jobId,
        filename,
        status: 'done',
        startedAt: this.last?.startedAt ?? new Date(t0).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
      };
      await publishEvent(this.redis.client, {
        type: 'backup.restore.done',
        payload: { jobId, filename, durationMs },
      });
      this.logger.log(`restore ${jobId} done in ${durationMs}ms`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      const error = err instanceof Error ? err.message : String(err);
      this.last = {
        jobId,
        filename,
        status: 'failed',
        startedAt: this.last?.startedAt ?? new Date(t0).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        error,
      };
      await publishEvent(this.redis.client, {
        type: 'backup.restore.failed',
        payload: { jobId, error, durationMs },
      }).catch(() => undefined);

      // Best-effort: reconnect Prisma even on failure so the api keeps
      // working with whatever state the DB is in.
      await this.prisma.client.$connect().catch(() => undefined);
    } finally {
      maintenanceHolder.exit();
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async setStage(jobId: string, stage: string, label: string): Promise<void> {
    if (this.last) this.last = { ...this.last, stage };
    await publishEvent(this.redis.client, {
      type: 'backup.restore.progress',
      payload: {
        jobId,
        stage: stage as
          | 'validating'
          | 'draining'
          | 'pg_restore'
          | 'untar_data'
          | 'migrate'
          | 'reopen'
          | 'reload',
        label,
      },
    });
  }

  /**
   * pg_terminate_backend other sessions so pg_restore --clean can DROP
   * the database objects without "is being used by other users" errors.
   * Uses a one-off psql; doesn't go through Prisma so it's not affected
   * by our pool state.
   */
  private async terminateOtherBackends(databaseUrl: string): Promise<void> {
    const url = new URL(databaseUrl);
    const dbName = url.pathname.replace(/^\//, '');
    const sql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName.replace(/'/g, "''")}' AND pid <> pg_backend_pid();`;
    await runPsqlOneShot(databaseUrl, sql).catch((err) => {
      // Best-effort: even if termination fails, restore can usually proceed.
      this.logger.warn(
        `pg_terminate_backend failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}

function sanitizeFilename(name: string): string {
  if (!/^mnela-[\w-]+\.tar\.gz$/.test(name)) {
    throw new BadRequestException(`invalid backup filename: ${name}`);
  }
  return name;
}

async function clearDir(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const e of entries) {
    await rm(path.join(dir, e), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
  };
}

async function runPsqlOneShot(databaseUrl: string, sql: string): Promise<void> {
  return spawnAttempt(['psql', ['-v', 'ON_ERROR_STOP=1', '-c', sql]], pgEnv(databaseUrl), null);
}

async function runPsqlRestore(databaseUrl: string, dumpGz: string): Promise<void> {
  // Pipe gunzip → psql via stdin.
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const tryNative = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const psql = spawn('psql', ['-v', 'ON_ERROR_STOP=1', '-d', dbName], {
        env: { ...pgEnv(databaseUrl) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      collectAndWait(psql, dumpGz, resolve, reject);
    });
  const tryDocker = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const psql = spawn(
        'docker',
        [
          'exec',
          '-i',
          '-e',
          `PGPASSWORD=${password}`,
          'mnela-postgres',
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          user,
          '-d',
          dbName,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      collectAndWait(psql, dumpGz, resolve, reject);
    });

  try {
    await tryNative();
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await tryDocker();
}

function collectAndWait(
  proc: import('node:child_process').ChildProcess,
  dumpGz: string,
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  if (!proc.stdin || !proc.stderr) {
    reject(new Error('psql spawned without stdin/stderr'));
    return;
  }
  const stderrChunks: Buffer[] = [];
  proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
  const gunzip = createGunzip();
  createReadStream(dumpGz).pipe(gunzip).pipe(proc.stdin);
  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else {
      const err = Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000);
      reject(new Error(`psql exited with code ${code}: ${err}`));
    }
  });
}

/**
 * Run `prisma migrate deploy`. We resolve prisma's CLI entry via
 * `require.resolve('prisma/build/index.js')` (works in pnpm workspace
 * and in pnpm-deployed prod tree alike) and run it directly through
 * the current node binary — bypassing the `.bin/` shell wrapper which
 * is platform-specific (.cmd on Windows, shebang script on Linux).
 *
 * The schema is also resolved relative to @mnela/db so the path is
 * correct in both dev (workspace symlinks) and prod (pnpm deploy
 * materialised tree).
 */
async function runPrismaMigrate(): Promise<void> {
  // Try several candidate locations for @mnela/db's package dir.
  // Dev (pnpm workspace) and prod (pnpm deploy --prod /out) put it
  // in different places; we probe both.
  const require = createRequire(import.meta.url);
  const candidatesDb = [
    () => path.dirname(require.resolve('@mnela/db/package.json')),
    () => path.resolve(process.cwd(), 'node_modules/@mnela/db'),
    () => path.resolve(process.cwd(), '../../packages/db'),
  ];
  let dbDir: string | null = null;
  for (const fn of candidatesDb) {
    try {
      const d = fn();
      const pkg = path.join(d, 'package.json');
      await stat(pkg);
      dbDir = d;
      break;
    } catch {
      // try next
    }
  }
  if (!dbDir) {
    throw new Error('@mnela/db package directory not found in any candidate location');
  }
  const schemaPath = path.resolve(dbDir, 'prisma/schema.prisma');

  // prisma cli lives near @mnela/db's own node_modules (workspace dep).
  const candidatesPrisma = [
    path.join(dbDir, 'node_modules/prisma/build/index.js'),
    path.resolve(dbDir, '../../node_modules/prisma/build/index.js'),
    path.resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
  ];
  let prismaEntry: string | null = null;
  for (const c of candidatesPrisma) {
    try {
      await stat(c);
      prismaEntry = c;
      break;
    } catch {
      // try next
    }
  }
  if (!prismaEntry) {
    throw new Error(`prisma cli not found near @mnela/db (tried: ${candidatesPrisma.join(', ')})`);
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [prismaEntry, 'migrate', 'deploy', `--schema=${schemaPath}`],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (!proc.stderr) {
      reject(new Error('prisma spawned without stderr'));
      return;
    }
    const stderrChunks: Buffer[] = [];
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const err = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
        reject(new Error(`prisma exited ${code}: ${err}`));
      }
    });
  });
}

async function spawnAttempt(
  [cmd, args]: [string, string[]],
  env: NodeJS.ProcessEnv,
  stdinPath: string | null,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env,
      stdio: stdinPath ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    if (!proc.stderr) {
      reject(new Error(`${cmd} spawned without stderr`));
      return;
    }
    const stderrChunks: Buffer[] = [];
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    if (stdinPath && proc.stdin) {
      createReadStream(stdinPath).pipe(proc.stdin);
    }
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const err = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
        reject(new Error(`${cmd} exited ${code}: ${err}`));
      }
    });
  });
}
