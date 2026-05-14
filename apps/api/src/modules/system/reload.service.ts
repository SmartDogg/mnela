import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MnelaEvent, publishEvent, subscribeEvents } from '@mnela/queue';
import type { Redis } from 'ioredis';

import { RedisService } from '../../redis.service.js';

export type ReloadHandler = () => Promise<{ note?: string } | void>;

const SERVICE_NAME = 'api' as const;

/**
 * In-process hot-reload for the api process. Mirrors the worker /
 * orchestrator ReloadService: subscribers (SearchService weights,
 * Throttler honest-noop, …) register a callback that re-reads the
 * registry. Each handler emits a `system.service_reload_ack` frame
 * the SystemService.requestRestart caller collects to render an
 * honest per-subscriber overlay instead of a blind timer.
 *
 * `ThrottlerModule` is bound at DI-graph construction so it can't be
 * hot-reloaded in-place — that handler registers as a "noop" with a
 * note so the operator knows the rate-limit change really needs an
 * OS-level restart. Don't silently lie about it.
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

  registerNoop(name: string, note: string): void {
    this.handlers.push({ name, fn: async () => ({ note }) });
    this.logger.debug(`reload noop handler registered: ${name} (${note})`);
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
        const result = await fn();
        const durationMs = Date.now() - startedAt;
        const note = result && typeof result === 'object' ? result.note : undefined;
        const status = note ? 'noop' : 'ok';
        this.logger.debug(`reload handler ${status}: ${name} (${durationMs}ms)`);
        await this.publishAck(requestId, name, { status, durationMs, note });
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
