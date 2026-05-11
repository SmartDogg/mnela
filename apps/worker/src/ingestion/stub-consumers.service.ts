import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type QueueName, createQueueConnection } from '@mnela/queue';
import { Worker } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';

/**
 * Drain-only Workers for queues whose real consumers don't exist yet.
 *
 *   'enrichment'    → live (apps/orchestrator EnrichmentConsumer, Phase 5)
 *   'transcription' → live (apps/worker TranscriptionConsumer, Phase 9)
 *   'indexing'      → Phase 11 (rebuild_index, export_vault)
 *   'maintenance'   → Phase 11 (backup, cleanup cron)
 *
 * Stubbing a queue that already has a real consumer is a load-bearing race
 * condition — BullMQ hands the job to whichever Worker grabs it first, and
 * the stub's `{stubbed:true}` return collapses the job before the real
 * consumer ever sees it. So this service only mounts stubs for the queues
 * still pending implementation.
 */
const STUBBED_QUEUES: QueueName[] = ['indexing', 'maintenance'];

@Injectable()
export class StubConsumersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StubConsumersService.name);
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    for (const name of STUBBED_QUEUES) {
      const connection = createQueueConnection(env.REDIS_URL);
      this.connections.push(connection);
      const worker = new Worker(
        name,
        async (job) => {
          this.logger.warn(
            `${name} stub received ${job.name} (id=${job.id}); will be implemented in Phase 11`,
          );
          return { stubbed: true };
        },
        { connection, concurrency: 1 },
      );
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all(
      this.connections.map((c) =>
        c.status === 'end' ? undefined : c.quit().catch(() => undefined),
      ),
    );
  }
}
