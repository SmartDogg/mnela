import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type IngestFileJob, QUEUE_NAMES, publishEvent } from '@mnela/queue';
import { Queue, type JobsOptions } from 'bullmq';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

/**
 * API-side BullMQ producer. Owns the queue handles for the lifetime of the
 * application; consumers live in apps/worker.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private ingestionQueue?: Queue<IngestFileJob>;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    void env;
    this.ingestionQueue = new Queue<IngestFileJob>(QUEUE_NAMES[0], {
      connection: this.redis.client,
    });
    await this.ingestionQueue.waitUntilReady();
    this.logger.log('bullmq ingestion queue connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.ingestionQueue?.close().catch(() => undefined);
  }

  async enqueueIngestFile(payload: IngestFileJob, opts: JobsOptions = {}): Promise<string> {
    if (!this.ingestionQueue) throw new Error('ingestion queue not initialized');
    const bullJob = await this.ingestionQueue.add('ingest_file', payload, {
      jobId: payload.dbJobId,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
      ...opts,
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: payload.dbJobId,
        jobType: 'ingest_file',
        createdAt: new Date().toISOString(),
      },
    });
    return bullJob.id ?? payload.dbJobId;
  }

  async pause(dbJobId: string): Promise<void> {
    const job = await this.ingestionQueue?.getJob(dbJobId);
    if (!job) return;
    // BullMQ doesn't support per-job pause; remove + re-add when resumed.
    // For Phase-2 we just mark the DB Job as paused via service — the BullMQ
    // worker will skip if the DB row is paused (or noop until restart).
  }

  async cancel(dbJobId: string): Promise<void> {
    const job = await this.ingestionQueue?.getJob(dbJobId);
    if (!job) return;
    await job.remove().catch(() => undefined);
  }
}
