import { readRegistryValue } from '@mnela/core';
import { SystemConfigRepository } from '@mnela/db';
import {
  QUEUE_NAMES,
  createQueueConnection,
  publishEvent,
  readEnrichmentSnapshot,
} from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

const TICK_INTERVAL_MS = 4000;

/**
 * Publishes `enrichment.queue.tick` every few seconds with a snapshot of the
 * BullMQ enrichment queue + slot owner + paused reasons + rolling rate / p50.
 * The api exposes the same shape via GET /jobs/queue-state for initial loads.
 *
 * Lives in the orchestrator (not api) because it is the only process that
 * is guaranteed to be running whenever there is anything to publish about —
 * if the api restarts mid-import, the orchestrator keeps ticking.
 */
@Injectable()
export class EnrichmentQueueStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnrichmentQueueStateService.name);
  private queue?: Queue;
  private connection?: Redis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.connection = createQueueConnection(env.REDIS_URL);
    this.queue = new Queue(QUEUE_NAMES[1], { connection: this.connection });
    await this.queue.waitUntilReady();
    // Emit once immediately so a fresh page load doesn't wait a full tick.
    await this.tick().catch((err) => this.logger.debug(`initial tick failed: ${String(err)}`));
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.debug(`tick failed: ${String(err)}`));
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue?.close().catch(() => undefined);
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit().catch(() => undefined);
    }
  }

  private async tick(): Promise<void> {
    if (!this.queue) return;
    const [parallelism, useSlot] = await Promise.all([
      readRegistryValue<number>(this.systemConfig, 'enrichment.parallelism'),
      readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot'),
    ]);
    const snapshot = await readEnrichmentSnapshot(this.queue, this.redis.client, {
      parallelism,
      useSlot,
    });
    await publishEvent(this.redis.client, {
      type: 'enrichment.queue.tick',
      payload: snapshot,
    });
  }
}
