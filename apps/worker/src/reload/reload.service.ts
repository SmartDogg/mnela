import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MnelaEvent, subscribeEvents } from '@mnela/queue';
import type { Redis } from 'ioredis';

import { RedisService } from '../redis.service.js';

export type ReloadHandler = () => Promise<void>;

/**
 * In-process hot-reload for BullMQ consumers in apps/worker.
 *
 * The "Restart Services" button in /admin/system publishes a
 * `system.service_reload` event over Redis pubsub. Each consumer that
 * holds long-lived state (BullMQ Workers configured with a concurrency
 * read once at boot, file watchers tied to a feature flag, etc.)
 * registers a callback here; on event receipt we call every callback
 * in turn so the post-toggle state takes effect without an actual
 * process restart — works the same under `pnpm dev` (where node
 * `--watch` does not auto-restart on `process.exit`), under
 * docker-compose, and under systemd.
 */
@Injectable()
export class ReloadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReloadService.name);
  private subscriber: Redis | null = null;
  private readonly handlers: { name: string; fn: ReloadHandler }[] = [];

  constructor(private readonly redis: RedisService) {}

  register(name: string, handler: ReloadHandler): void {
    this.handlers.push({ name, fn: handler });
    this.logger.debug(`reload handler registered: ${name}`);
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.client.duplicate();
    await this.subscriber.connect();
    await subscribeEvents(this.subscriber, (event: MnelaEvent) => {
      if (event.type !== 'system.service_reload') return;
      const target = event.payload.service;
      if (target !== 'all' && target !== 'worker') return;
      void this.runHandlers(event.payload.reason);
    });
    this.logger.log('subscribed to system.service_reload');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  private async runHandlers(reason: string): Promise<void> {
    this.logger.log(`reload requested (reason=${reason}); ${this.handlers.length} handlers`);
    for (const { name, fn } of this.handlers) {
      try {
        await fn();
        this.logger.debug(`reload handler ok: ${name}`);
      } catch (err) {
        this.logger.error(
          `reload handler "${name}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
