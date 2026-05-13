import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import { JobRepository, SystemConfigRepository } from '@mnela/db';
import { type IngestFileJob, QUEUE_NAMES, createQueueConnection } from '@mnela/queue';

import { ReloadService } from '../reload/reload.service.js';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import chokidar, { type FSWatcher } from 'chokidar';
import { type Redis } from 'ioredis';

import { dropboxDir, loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

const STABILITY_MS = 1500;

@Injectable()
export class DropboxWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DropboxWatcher.name);
  private watcher?: FSWatcher;
  private queue?: Queue<IngestFileJob>;
  private bullConnection?: Redis;
  /**
   * Filepaths whose `add` event we've already enqueued but BullMQ hasn't
   * acked completion for. chokidar `awaitWriteFinish` debounces during a
   * single write, but multi-GB copies on Windows trip it into firing
   * twice — and even within a single fire, a worker restart can re-scan
   * the dir on init. Without this guard each duplicate fire enqueued a
   * fresh job → for a 1.4 GB ZIP we got 4 parallel ingestion runs in
   * the same worker, ~6 GB of temp ZIP shards on disk + an OOM. Keyed by
   * absolute path; cleared once the job is enqueued *and* a debounce
   * window has passed.
   */
  private readonly inflight = new Set<string>();
  private static readonly INFLIGHT_HOLD_MS = 30_000;

  constructor(
    private readonly redis: RedisService,
    private readonly jobs: JobRepository,
    private readonly systemConfig: SystemConfigRepository,
    private readonly reload: ReloadService,
  ) {
    void this.redis;
  }

  async onModuleInit(): Promise<void> {
    await this.startWatching();
    this.reload.register('dropbox.watcher', () => this.restart());
  }

  private async startWatching(): Promise<void> {
    const env = loadEnv();
    const enabled = await readRegistryValue<boolean>(
      this.systemConfig,
      'ingestion.dropbox.enabled',
    );
    if (!enabled) {
      this.logger.warn('dropbox watcher disabled via ingestion.dropbox.enabled');
      return;
    }
    const dir = dropboxDir(env);
    await fs.mkdir(dir, { recursive: true });

    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.queue = new Queue<IngestFileJob>(QUEUE_NAMES[0], { connection: this.bullConnection });
    await this.queue.waitUntilReady();

    this.watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      depth: 0,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: STABILITY_MS, pollInterval: 200 },
    });

    this.watcher.on('add', (filePath) => {
      void this.enqueue(filePath).catch((err: unknown) => {
        this.logger.error(
          `dropbox enqueue failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    this.watcher.on('error', (err) => {
      this.logger.error(`watcher error: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.logger.log(`watching ${dir}`);
  }

  private async restart(): Promise<void> {
    this.logger.log('reloading dropbox watcher');
    await this.stopWatching();
    await this.startWatching();
  }

  private async stopWatching(): Promise<void> {
    await this.watcher?.close().catch(() => undefined);
    this.watcher = undefined;
    await this.queue?.close().catch(() => undefined);
    this.queue = undefined;
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
    this.bullConnection = undefined;
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopWatching();
  }

  private async enqueue(filePath: string): Promise<void> {
    if (!this.queue) return;
    if (this.inflight.has(filePath)) {
      this.logger.debug(`dropbox skip duplicate add for ${path.basename(filePath)}`);
      return;
    }
    this.inflight.add(filePath);
    // Release the dedup slot after 30s; by then the worker has either
    // started processing (Job row → status=running) or rejected the job.
    // Worth noting: the lock is process-local — if a separate watcher
    // instance is running it will still race. There's only ever one
    // DropboxWatcher per worker process, and operators rarely run >1
    // worker against the same dropbox folder in practice.
    setTimeout(() => this.inflight.delete(filePath), DropboxWatcher.INFLIGHT_HOLD_MS).unref();

    const filename = path.basename(filePath);
    const stat = await fs.stat(filePath);
    // Streaming hash — `fs.readFile` here was an OOM for multi-GB exports
    // (the dropbox path was bypassed by the disk-storage Multer rewrite but
    // still buffered the whole file just to compute its hash).
    const contentHash = await streamingSha256(filePath);
    const mimeType = inferMime(filename);

    const dbJob = await this.jobs.create({
      type: 'ingest_file',
      payload: {
        filename,
        mimetype: mimeType,
        size: stat.size,
        contentHash,
        receivedAt: new Date().toISOString(),
        origin: 'dropbox',
        source: 'manual_upload',
      } as unknown as Prisma.InputJsonValue,
      priority: 50,
    });

    await this.queue.add(
      'ingest_file',
      {
        dbJobId: dbJob.id,
        filePath,
        originalName: filename,
        mimeType,
        size: stat.size,
        contentHash,
        origin: 'dropbox',
      },
      { jobId: dbJob.id, removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } },
    );

    this.logger.log(`dropbox → enqueued ingest_file job=${dbJob.id} for ${filename}`);
  }
}

function streamingSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.once('end', () => resolve(hash.digest('hex')));
    stream.once('error', reject);
  });
}

function inferMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.json': 'application/json',
    '.jsonl': 'application/x-ndjson',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/x-m4a',
  };
  return map[ext] ?? 'application/octet-stream';
}
