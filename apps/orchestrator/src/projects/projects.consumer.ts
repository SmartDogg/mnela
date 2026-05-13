import { JobRepository, PrismaService } from '@mnela/db';
import {
  type ProjectAutofillJob,
  type ProjectSuggestJob,
  QUEUE_NAMES,
  createQueueConnection,
  publishEvent,
} from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Worker, type Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';
import { ProjectsAutofillService } from './projects-autofill.service.js';
import { ProjectsSuggesterService } from './projects-suggester.service.js';

type ProjectsJobData = ProjectSuggestJob | ProjectAutofillJob;

function isAutofill(data: ProjectsJobData): data is ProjectAutofillJob {
  return (data as ProjectAutofillJob).projectId !== undefined;
}

/**
 * BullMQ consumer for the `projects` queue. Routes to either the suggester
 * (mode='batch' or 'rescan') or the autofill service. Mirrors the
 * enrichment consumer's DB Job lifecycle so /jobs surfaces these
 * uniformly. Concurrency is intentionally low (1) — these jobs are bursty
 * (rescan touches the whole corpus) and run on idle.
 */
@Injectable()
export class ProjectsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsConsumer.name);
  private worker?: Worker<ProjectsJobData>;
  private bullConnection?: Redis;

  constructor(
    private readonly suggester: ProjectsSuggesterService,
    private readonly autofill: ProjectsAutofillService,
    private readonly jobs: JobRepository,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.worker = new Worker<ProjectsJobData>(
      QUEUE_NAMES[5], // 'projects'
      async (bullJob) => this.handle(bullJob),
      { connection: this.bullConnection, concurrency: 1 },
    );
    this.worker.on('failed', (bullJob, err) => {
      this.logger.error(
        `projects job ${bullJob?.id ?? '?'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await this.worker.waitUntilReady();
    this.logger.log('projects worker ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
  }

  private async handle(bullJob: BullJob<ProjectsJobData>): Promise<unknown> {
    const data = bullJob.data;
    const jobType = isAutofill(data) ? 'project_autofill' : 'project_suggest';
    await this.jobs.setStatus(data.dbJobId, 'running').catch(() => undefined);
    await publishEvent(this.redis.client, {
      type: 'job.started',
      payload: { jobId: data.dbJobId, jobType, startedAt: new Date().toISOString() },
    });

    try {
      const result = isAutofill(data)
        ? await this.autofill.run(data.projectId)
        : await this.suggester.run({ mode: data.mode, batchId: data.batchId });

      await this.prisma.client.job
        .update({
          where: { id: data.dbJobId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            result: result as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);

      await publishEvent(this.redis.client, {
        type: 'job.completed',
        payload: {
          jobId: data.dbJobId,
          result,
          completedAt: new Date().toISOString(),
        },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.jobs.setStatus(data.dbJobId, 'failed', message).catch(() => undefined);
      await publishEvent(this.redis.client, {
        type: 'job.failed',
        payload: {
          jobId: data.dbJobId,
          error: message,
          failedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
      throw err;
    }
  }
}
