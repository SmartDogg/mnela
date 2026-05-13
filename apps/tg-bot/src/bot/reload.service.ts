import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MnelaEvent, subscribeEvents } from '@mnela/queue';
import type { Redis } from 'ioredis';

import { type RedisService } from '../redis/redis.service.js';
import { type BotService } from './bot.service.js';

/**
 * Subscribes to the shared `mnela:events` pubsub channel and triggers a
 * BotService reload on `system.telegram_reload`. Uses a duplicated Redis
 * connection because ioredis enters subscribe-mode exclusively on the
 * subscribing socket.
 *
 * Best-effort — if the subscription drops we log and let ioredis
 * auto-reconnect; missed reloads are recovered by the user issuing
 * another PATCH or by the next polled-config window (none currently;
 * we rely on the event).
 */
@Injectable()
export class ReloadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReloadService.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly bot: BotService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.client.duplicate();
    await this.subscriber.connect();
    await subscribeEvents(this.subscriber, (event: MnelaEvent) => {
      if (event.type !== 'system.telegram_reload') return;
      const reason = event.payload.reason ?? 'manual';
      this.logger.log(`reload requested via pubsub (reason=${reason})`);
      void this.bot.reload(reason).catch((err) => {
        this.logger.error(`reload failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
    this.logger.log('subscribed to mnela:events for telegram_reload');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }
}
