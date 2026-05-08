import { type EnrichmentJob, createQueueConnection, publishEvent, QUEUE_NAMES } from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';
import { EnrichmentPipeline } from './pipeline.js';

@Injectable()
export class EnrichmentConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnrichmentConsumer.name);
  private worker?: Worker<EnrichmentJob>;
  private bullConnection?: Redis;

  constructor(
    private readonly pipeline: EnrichmentPipeline,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.worker = new Worker<EnrichmentJob>(
      QUEUE_NAMES[1], // 'enrichment'
      async (bullJob) => this.handleJob(bullJob),
      {
        connection: this.bullConnection,
        concurrency: env.MNELA_ENRICHMENT_CONCURRENCY,
      },
    );

    this.worker.on('failed', (bullJob, err) => {
      this.logger.error(
        `enrichment job ${bullJob?.id ?? '?'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    await this.worker.waitUntilReady();
    this.logger.log(`enrichment worker ready (concurrency=${env.MNELA_ENRICHMENT_CONCURRENCY})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
  }

  private async handleJob(bullJob: BullJob<EnrichmentJob>): Promise<unknown> {
    const data = bullJob.data;
    if (!data.documentId) {
      this.logger.warn(`enrichment job ${bullJob.id} has no documentId — skipping`);
      return { status: 'skipped' };
    }

    await publishEvent(this.redis.client, {
      type: 'job.started',
      payload: {
        jobId: data.dbJobId,
        jobType: 'enrich_document',
        startedAt: new Date().toISOString(),
      },
    });

    try {
      const outcome = await this.pipeline.run({
        dbJobId: data.dbJobId,
        documentId: data.documentId,
      });

      await publishEvent(this.redis.client, {
        type: 'job.completed',
        payload: {
          jobId: data.dbJobId,
          result: outcome,
          completedAt: new Date().toISOString(),
        },
      });

      // Surface a non-retryable error if the pipeline detected rate-limit /
      // auth-error so BullMQ doesn't retry against a paused queue. The
      // RateLimitService already paused; the next job will simply not run.
      if (outcome.status === 'rate-limited' || outcome.status === 'auth-error') {
        return outcome;
      }

      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await publishEvent(this.redis.client, {
        type: 'job.failed',
        payload: { jobId: data.dbJobId, error: message, failedAt: new Date().toISOString() },
      }).catch(() => undefined);
      throw err;
    }
  }
}
