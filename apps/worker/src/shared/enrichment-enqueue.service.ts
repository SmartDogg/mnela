import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import { JobRepository, SystemConfigRepository } from '@mnela/db';
import {
  type EnrichmentJob,
  QUEUE_NAMES,
  createQueueConnection,
  readClaudeStatus,
} from '@mnela/queue';
import { Queue } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

/**
 * Single owner of the "enqueue enrichment if Claude is up" decision.
 * Used by IngestionConsumer (text uploads) and TranscriptionConsumer
 * (audio uploads, once whisper finished). Keeps the ADR-0027 gate in
 * one place so the rule does not drift between producers.
 */
@Injectable()
export class EnrichmentEnqueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnrichmentEnqueueService.name);
  private queue?: Queue<EnrichmentJob>;
  private connection?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly jobs: JobRepository,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    this.connection = createQueueConnection(env.REDIS_URL);
    this.queue = new Queue<EnrichmentJob>(QUEUE_NAMES[1], { connection: this.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit().catch(() => undefined);
    }
  }

  async maybeEnqueue(documentId: string): Promise<{ enqueued: boolean; reason?: string }> {
    if (!this.queue) return { enqueued: false, reason: 'queue-not-ready' };
    const status = await readClaudeStatus(this.redis.client);
    if (!status.available) {
      this.logger.debug(
        `enrichment skipped for ${documentId}: claude unavailable (${status.reason ?? 'unknown'})`,
      );
      return { enqueued: false, reason: status.reason ?? 'unavailable' };
    }
    const enrichmentJob = await this.jobs.create({
      type: 'enrich_document',
      payload: { documentId },
      documentId,
    });
    const attempts = await readRegistryValue<number>(this.systemConfig, 'enrichment.attempts');
    const delay = await readRegistryValue<number>(this.systemConfig, 'enrichment.backoffMs');
    await this.queue.add(
      'enrich-document',
      { dbJobId: enrichmentJob.id, documentId },
      {
        attempts,
        backoff: { type: 'exponential', delay },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    return { enqueued: true };
  }

  /**
   * Enqueue an analyze_attachment job for an image. The orchestrator's
   * vision pipeline (apps/orchestrator/src/enrichment) reads SystemConfig
   * `attachments.imageAnalysisEnabled` + `.Backend` + `.Model` at consume
   * time, so we don't need to gate it here beyond the global Claude-status
   * check that we already share with text enrichment.
   *
   * The same BullMQ queue (`enrichment`) handles both job kinds — the
   * consumer dispatches on `attachmentId` vs `documentId`. Reusing the
   * queue keeps the ADR-0027 single-slot guarantee intact.
   */
  async maybeEnqueueImage(
    attachmentId: string,
    documentId: string,
  ): Promise<{ enqueued: boolean; reason?: string }> {
    if (!this.queue) return { enqueued: false, reason: 'queue-not-ready' };
    const status = await readClaudeStatus(this.redis.client);
    if (!status.available) {
      this.logger.debug(
        `image analysis skipped for ${attachmentId}: claude unavailable (${status.reason ?? 'unknown'})`,
      );
      return { enqueued: false, reason: status.reason ?? 'unavailable' };
    }
    const job = await this.jobs.create({
      type: 'analyze_attachment',
      payload: { attachmentId, documentId },
      documentId,
    });
    const attempts = await readRegistryValue<number>(this.systemConfig, 'enrichment.imageAttempts');
    const delay = await readRegistryValue<number>(this.systemConfig, 'enrichment.imageBackoffMs');
    await this.queue.add(
      'analyze-attachment',
      { dbJobId: job.id, attachmentId, documentId },
      {
        attempts,
        backoff: { type: 'exponential', delay },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    return { enqueued: true };
  }
}
