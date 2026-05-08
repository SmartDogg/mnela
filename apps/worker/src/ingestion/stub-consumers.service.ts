import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { QUEUE_NAMES, createQueueConnection } from '@mnela/queue';
import { Worker } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';

/**
 * Stub Workers for enrichment, indexing, and maintenance queues. Phase-2
 * acceptance only requires the queues exist and don't deadlock — the real
 * consumers land in Phase 5 (Claude orchestrator) and Phase 11 (maintenance).
 */
@Injectable()
export class StubConsumersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StubConsumersService.name);
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    for (const name of QUEUE_NAMES.slice(1)) {
      const connection = createQueueConnection(env.REDIS_URL);
      this.connections.push(connection);
      const worker = new Worker(
        name,
        async (job) => {
          this.logger.warn(
            `${name} stub received ${job.name} (id=${job.id}); will be implemented in a later phase`,
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
