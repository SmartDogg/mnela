import { JobRepository, PrismaService } from '@mnela/db';
import { type EnrichmentJob, createQueueConnection, publishEvent, QUEUE_NAMES } from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DelayedError, Worker, type Job as BullJob } from 'bullmq';
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
    private readonly jobs: JobRepository,
    private readonly prisma: PrismaService,
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
    const isImageAnalysis = Boolean(data.attachmentId);
    const isProjectContext = !isImageAnalysis && !data.documentId && Boolean(data.projectSlug);
    if (!isImageAnalysis && !data.documentId && !data.projectSlug) {
      this.logger.warn(
        `enrichment job ${bullJob.id} has no documentId/projectSlug/attachmentId — skipping`,
      );
      return { status: 'skipped' };
    }

    const jobType = isImageAnalysis
      ? 'analyze_attachment'
      : isProjectContext
        ? 'refresh_project_context'
        : 'enrich_document';
    // Sync DB Job → 'running' before doing anything else. Mirrors the worker's
    // markRunning pattern; without this the row stays at status='queued',
    // attempts=0, startedAt=null forever after enrichment runs (live UI then
    // shows ghost-queued jobs and JobStats numbers drift).
    await this.jobs.setStatus(data.dbJobId, 'running').catch(() => undefined);
    await publishEvent(this.redis.client, {
      type: 'job.started',
      payload: { jobId: data.dbJobId, jobType, startedAt: new Date().toISOString() },
    });

    try {
      const outcome = isImageAnalysis
        ? await this.pipeline.runImageAnalysis({
            dbJobId: data.dbJobId,
            attachmentId: data.attachmentId!,
          })
        : isProjectContext
          ? await this.pipeline.runProjectContext({
              dbJobId: data.dbJobId,
              projectSlug: data.projectSlug!,
            })
          : await this.pipeline.run({
              dbJobId: data.dbJobId,
              documentId: data.documentId!,
            });

      if (outcome.status === 'skipped' && outcome.reason?.startsWith('slot-held-by-')) {
        // ADR-0041: yield the Claude slot to Ask Brain; re-queue this job
        // 30s later. moveToDelayed + DelayedError tells BullMQ this isn't
        // a failure and shouldn't consume an attempts counter.
        await this.jobs.setStatus(data.dbJobId, 'queued').catch(() => undefined);
        await bullJob.moveToDelayed(Date.now() + 30_000, bullJob.token ?? '');
        throw new DelayedError(`yielded to ${outcome.reason}`);
      }

      // Map pipeline outcome → DB Job terminal status.
      // 'enriched' / 'skipped' (when claude unavailable or rate-limit window
      // is paused) → completed; everything else is a failure surface that
      // the operator should see in /jobs.
      const dbStatus =
        outcome.status === 'enriched' || outcome.status === 'skipped' ? 'completed' : 'failed';
      const errorMessage = dbStatus === 'failed' ? (outcome.reason ?? outcome.status) : undefined;
      await this.prisma.client.job
        .update({
          where: { id: data.dbJobId },
          data: {
            status: dbStatus,
            completedAt: new Date(),
            result: outcome as unknown as Prisma.InputJsonValue,
            ...(errorMessage ? { error: errorMessage } : {}),
          },
        })
        .catch(() => undefined);

      if (dbStatus === 'completed') {
        await publishEvent(this.redis.client, {
          type: 'job.completed',
          payload: {
            jobId: data.dbJobId,
            result: outcome,
            completedAt: new Date().toISOString(),
          },
        });
      } else {
        await publishEvent(this.redis.client, {
          type: 'job.failed',
          payload: {
            jobId: data.dbJobId,
            error: errorMessage ?? 'unknown',
            failedAt: new Date().toISOString(),
          },
        });
      }

      return outcome;
    } catch (err) {
      if (err instanceof DelayedError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await this.jobs.setStatus(data.dbJobId, 'failed', message).catch(() => undefined);
      await publishEvent(this.redis.client, {
        type: 'job.failed',
        payload: { jobId: data.dbJobId, error: message, failedAt: new Date().toISOString() },
      }).catch(() => undefined);
      throw err;
    }
  }
}
