import { JobRepository } from '@mnela/db';
import {
  type ProjectAutofillJob,
  type ProjectSuggestJob,
  QUEUE_NAMES,
  createQueueConnection,
  publishEvent,
} from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

const DEBOUNCE_MS = 5 * 60_000;

/**
 * Orchestrator-side producer for the `projects` queue. Lives here (not in
 * api/queue.service) because the post-enrichment debounce trigger needs to
 * fire from the orchestrator's enrichment.consumer right after a document
 * finishes. The api enqueues through this service too — see
 * /projects/suggestions/rescan and /projects/:slug/autofill.
 *
 * Why the orchestrator owns *both* sides of this queue: the suggester runs
 * inside the orchestrator process (it shares Prisma + the providers
 * service), so colocating the producer keeps job lifecycle simple. The api
 * forwards rescan/autofill requests through HTTP to the orchestrator's
 * boot-time-shared Redis instance, just like enrichment.
 */
@Injectable()
export class ProjectsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsQueueService.name);
  private queue?: Queue;
  private bullConnection?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly jobs: JobRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.queue = new Queue(QUEUE_NAMES[5], { connection: this.bullConnection });
    await this.queue.waitUntilReady();
    this.logger.log('projects queue connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
  }

  /**
   * Debounced suggest for one import batch. Schedules a delayed job with a
   * deterministic id so subsequent calls within the debounce window collapse
   * into a single execution. Idempotent — if a job is already queued/running
   * we keep the existing one.
   */
  async debounceBatchSuggest(batchId: string): Promise<void> {
    if (!this.queue) return;
    const jobId = `suggest:batch:${batchId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState().catch(() => undefined);
      if (state === 'delayed') {
        await existing.changeDelay(DEBOUNCE_MS).catch(() => undefined);
        return;
      }
      // running/completed/failed — leave it alone; the next enqueue would
      // collide on jobId. If the user wants to re-run, /rescan covers it.
      return;
    }
    const dbJob = await this.jobs.create({
      type: 'project_suggest',
      payload: { mode: 'batch', batchId },
    });
    const payload: ProjectSuggestJob = { dbJobId: dbJob.id, mode: 'batch', batchId };
    await this.queue.add('project_suggest', payload, {
      jobId,
      delay: DEBOUNCE_MS,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: dbJob.id,
        jobType: 'project_suggest',
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Full rescan — kicks the detector across all recent batches and
   * entity clusters. Triggered by the "Rescan suggestions" button on
   * /projects/new. Uses a date-stamped jobId so users can't accidentally
   * fire it twice a second.
   */
  async enqueueRescan(): Promise<{ jobId: string }> {
    if (!this.queue) throw new Error('projects queue not ready');
    const jobId = `suggest:rescan:${new Date().toISOString().slice(0, 16)}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      return { jobId: existing.id ?? jobId };
    }
    const dbJob = await this.jobs.create({
      type: 'project_suggest',
      payload: { mode: 'rescan' },
    });
    const payload: ProjectSuggestJob = { dbJobId: dbJob.id, mode: 'rescan' };
    await this.queue.add('project_suggest', payload, {
      jobId,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: dbJob.id,
        jobType: 'project_suggest',
        createdAt: new Date().toISOString(),
      },
    });
    return { jobId: dbJob.id };
  }

  /** Autofill for a manual project. */
  async enqueueAutofill(projectId: string): Promise<{ jobId: string }> {
    if (!this.queue) throw new Error('projects queue not ready');
    const dbJob = await this.jobs.create({
      type: 'project_autofill',
      payload: { projectId },
    });
    const payload: ProjectAutofillJob = { dbJobId: dbJob.id, projectId };
    await this.queue.add('project_autofill', payload, {
      jobId: dbJob.id,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: dbJob.id,
        jobType: 'project_autofill',
        createdAt: new Date().toISOString(),
      },
    });
    return { jobId: dbJob.id };
  }
}
