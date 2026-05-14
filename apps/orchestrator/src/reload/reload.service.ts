import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MnelaEvent, publishEvent, subscribeEvents } from '@mnela/queue';
import type { Redis } from 'ioredis';

import { RedisService } from '../redis.service.js';

export type ReloadHandler = () => Promise<void>;

const SERVICE_NAME = 'orchestrator' as const;

/**
 * Mirror of `apps/worker/src/reload/reload.service.ts` for the orchestrator
 * process. Subscribers (e.g. `EnrichmentConsumer`) register a callback that
 * closes + recreates their BullMQ Worker so registry-driven values like
 * `enrichment.parallelism` take effect on the next "Restart Services"
 * click without an OS-level process restart. Each handler run publishes
 * a `system.service_reload_ack` frame the api collects to render an
 * honest per-subscriber overlay.
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
      if (target !== 'all' && target !== SERVICE_NAME) return;
      void this.runHandlers(event.payload.reason, event.payload.requestId);
    });
    this.logger.log('subscribed to system.service_reload');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  private async runHandlers(reason: string, requestId: string): Promise<void> {
    this.logger.log(
      `reload requested (reason=${reason}, requestId=${requestId}); ${this.handlers.length} handlers`,
    );
    for (const { name, fn } of this.handlers) {
      const startedAt = Date.now();
      try {
        await fn();
        const durationMs = Date.now() - startedAt;
        this.logger.debug(`reload handler ok: ${name} (${durationMs}ms)`);
        await this.publishAck(requestId, name, { status: 'ok', durationMs });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`reload handler "${name}" threw: ${message}`);
        await this.publishAck(requestId, name, { status: 'error', durationMs, error: message });
      }
    }
  }

  private async publishAck(
    requestId: string,
    subscriber: string,
    extra: { status: 'ok' | 'error' | 'noop'; durationMs: number; error?: string; note?: string },
  ): Promise<void> {
    await publishEvent(this.redis.client, {
      type: 'system.service_reload_ack',
      payload: {
        requestId,
        service: SERVICE_NAME,
        subscriber,
        ...extra,
      },
    }).catch((err: unknown) => {
      this.logger.warn(
        `failed to publish reload ack for ${subscriber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
