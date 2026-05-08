import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type IngestFileJob, QUEUE_NAMES, createQueueConnection, publishEvent } from '@mnela/queue';
import { Queue, type JobsOptions } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

/**
 * API-side BullMQ producer. Owns the queue handle for the lifetime of the
 * application; consumers live in apps/worker. Uses a dedicated Redis
 * connection because BullMQ requires `maxRetriesPerRequest: null`.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private ingestionQueue?: Queue<IngestFileJob>;
  private bullConnection?: Redis;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.ingestionQueue = new Queue<IngestFileJob>(QUEUE_NAMES[0], {
      connection: this.bullConnection,
    });
    await this.ingestionQueue.waitUntilReady();
    this.logger.log('bullmq ingestion queue connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.ingestionQueue?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
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

  async cancel(dbJobId: string): Promise<void> {
    const job = await this.ingestionQueue?.getJob(dbJobId);
    if (!job) return;
    await job.remove().catch(() => undefined);
  }
}
