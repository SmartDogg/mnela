import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JobRepository } from '@mnela/db';
import { sha256Hex } from '@mnela/ingestion';
import { type IngestFileJob, QUEUE_NAMES, createQueueConnection } from '@mnela/queue';
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

  constructor(
    private readonly redis: RedisService,
    private readonly jobs: JobRepository,
  ) {
    void this.redis;
  }

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    if (env.WORKER_DROPBOX_DISABLED) {
      this.logger.warn('dropbox watcher disabled via WORKER_DROPBOX_DISABLED');
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

  async onModuleDestroy(): Promise<void> {
    await this.watcher?.close();
    await this.queue?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
  }

  private async enqueue(filePath: string): Promise<void> {
    if (!this.queue) return;
    const filename = path.basename(filePath);
    const stat = await fs.stat(filePath);
    const buf = await fs.readFile(filePath);
    const contentHash = sha256Hex(buf);
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
