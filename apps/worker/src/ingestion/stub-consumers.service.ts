import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { QUEUE_NAMES } from '@mnela/queue';
import { Worker } from 'bullmq';

import { RedisService } from '../redis.service.js';

/**
 * Stub Workers for enrichment, indexing, and maintenance queues.
 * Phase-2 acceptance only requires that the queues exist and don't deadlock —
 * the real consumers land in Phase 5 (Claude orchestrator) and Phase 11
 * (maintenance crons).
 */
@Injectable()
export class StubConsumersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StubConsumersService.name);
  private readonly workers: Worker[] = [];

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    for (const name of QUEUE_NAMES.slice(1)) {
      const worker = new Worker(
        name,
        async (job) => {
          this.logger.warn(
            `${name} stub received ${job.name} (id=${job.id}); will be implemented in a later phase`,
          );
          return { stubbed: true };
        },
        { connection: this.redis.client, concurrency: 1 },
      );
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
  }
}
