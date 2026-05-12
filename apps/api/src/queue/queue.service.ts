import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import { SystemConfigRepository } from '@mnela/db';
import {
  type EnrichmentJob,
  type EnrichmentSnapshot,
  type IngestFileJob,
  type TranscribeAudioJob,
  QUEUE_NAMES,
  createQueueConnection,
  publishEvent,
  readEnrichmentSnapshot,
  setEnrichmentUserPaused,
} from '@mnela/queue';
import { Queue, type JobsOptions } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

/**
 * API-side BullMQ producer. Owns the queue handles for the lifetime of the
 * application; consumers live in apps/worker (ingestion/transcription) and
 * apps/orchestrator (enrichment). Uses a dedicated Redis connection because
 * BullMQ requires `maxRetriesPerRequest: null`.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private ingestionQueue?: Queue<IngestFileJob>;
  private transcriptionQueue?: Queue<TranscribeAudioJob>;
  private enrichmentQueue?: Queue<EnrichmentJob>;
  private bullConnection?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.ingestionQueue = new Queue<IngestFileJob>(QUEUE_NAMES[0], {
      connection: this.bullConnection,
    });
    this.enrichmentQueue = new Queue<EnrichmentJob>(QUEUE_NAMES[1], {
      connection: this.bullConnection,
    });
    this.transcriptionQueue = new Queue<TranscribeAudioJob>(QUEUE_NAMES[4], {
      connection: this.bullConnection,
    });
    await this.ingestionQueue.waitUntilReady();
    await this.enrichmentQueue.waitUntilReady();
    await this.transcriptionQueue.waitUntilReady();
    this.logger.log('bullmq ingestion + enrichment + transcription queues connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.ingestionQueue?.close().catch(() => undefined);
    await this.enrichmentQueue?.close().catch(() => undefined);
    await this.transcriptionQueue?.close().catch(() => undefined);
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

  async enqueueEnrichment(payload: EnrichmentJob, opts: JobsOptions = {}): Promise<string> {
    if (!this.enrichmentQueue) throw new Error('enrichment queue not initialized');
    // Mirror worker's enqueue (apps/worker/src/shared/enrichment-enqueue.service.ts):
    // job-name 'enrich-document' (the orchestrator consumer matches on this), with
    // BullMQ retry attempts + exponential backoff from SystemConfig (defaults
    // live in @mnela/core registry — see ADR-0027).
    const jobName = payload.projectSlug ? 'refresh-project-context' : 'enrich-document';
    const attempts = await readRegistryValue<number>(this.systemConfig, 'enrichment.attempts');
    const delay = await readRegistryValue<number>(this.systemConfig, 'enrichment.backoffMs');
    const bullJob = await this.enrichmentQueue.add(jobName, payload, {
      jobId: payload.dbJobId,
      attempts,
      backoff: { type: 'exponential', delay },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
      ...opts,
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: payload.dbJobId,
        jobType: payload.projectSlug ? 'refresh_project_context' : 'enrich_document',
        createdAt: new Date().toISOString(),
      },
    });
    return bullJob.id ?? payload.dbJobId;
  }

  async enqueueTranscribeAudio(
    payload: TranscribeAudioJob,
    opts: JobsOptions = {},
  ): Promise<string> {
    if (!this.transcriptionQueue) throw new Error('transcription queue not initialized');
    const attempts = await readRegistryValue<number>(
      this.systemConfig,
      'worker.transcription.attempts',
    );
    const delay = await readRegistryValue<number>(
      this.systemConfig,
      'worker.transcription.backoffMs',
    );
    const bullJob = await this.transcriptionQueue.add('transcribe-audio', payload, {
      jobId: payload.dbJobId,
      attempts,
      backoff: { type: 'exponential', delay },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
      ...opts,
    });
    await publishEvent(this.redis.client, {
      type: 'job.created',
      payload: {
        jobId: payload.dbJobId,
        jobType: 'transcribe_audio',
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

  /**
   * Read-only snapshot of the enrichment queue + slot owner + paused
   * reasons. Mirrors the payload published by the orchestrator's
   * `enrichment.queue.tick` so /jobs can initial-load this and then patch
   * via live events.
   */
  async getEnrichmentQueueSnapshot(): Promise<EnrichmentSnapshot> {
    if (!this.enrichmentQueue) throw new Error('enrichment queue not initialized');
    const [parallelism, useSlot] = await Promise.all([
      readRegistryValue<number>(this.systemConfig, 'enrichment.parallelism'),
      readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot'),
    ]);
    return readEnrichmentSnapshot(this.enrichmentQueue, this.redis.client, {
      parallelism,
      useSlot,
    });
  }

  /**
   * Toggle the user-initiated pause. Distinct from RateLimitService's
   * automatic pause (handled in the orchestrator) so a manual resume can't
   * defeat an active rate-limit window, and clearing the rate-limit can't
   * un-pause a manually paused queue.
   */
  async setEnrichmentPaused(paused: boolean): Promise<void> {
    if (!this.enrichmentQueue) throw new Error('enrichment queue not initialized');
    await setEnrichmentUserPaused(this.enrichmentQueue, this.redis.client, paused);
  }
}
