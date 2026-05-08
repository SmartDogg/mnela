import { createQueueConnection, QUEUE_NAMES } from '@mnela/queue';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadEnv } from '../env.js';

const RATE_LIMIT_KEY = 'mnela:claude:rate-limit';

interface RateLimitState {
  resetAt: string;
}

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private connection?: Redis;
  private queue?: Queue;
  private resumeTimer?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.connection = createQueueConnection(env.REDIS_URL);
    this.queue = new Queue(QUEUE_NAMES[1], { connection: this.connection });
    await this.recover();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    await this.queue?.close().catch(() => undefined);
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit().catch(() => undefined);
    }
  }

  /**
   * On boot we may have been killed mid rate-limit. If a future resetAt is
   * persisted, schedule a resume; if past, clear the marker.
   */
  private async recover(): Promise<void> {
    if (!this.queue) return;
    const raw = await this.queue.client.then((c) => c.get(RATE_LIMIT_KEY));
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as RateLimitState;
      const reset = new Date(state.resetAt);
      const now = Date.now();
      if (reset.getTime() <= now) {
        await this.resume();
      } else {
        await this.queue.pause();
        this.scheduleResume(reset);
      }
    } catch {
      await this.queue.client.then((c) => c.del(RATE_LIMIT_KEY)).catch(() => undefined);
    }
  }

  async pause(resetAt: Date | null): Promise<void> {
    if (!this.queue) throw new Error('RateLimitService not initialised');
    const effective = resetAt ?? new Date(Date.now() + 5 * 60 * 60 * 1000);
    const state: RateLimitState = { resetAt: effective.toISOString() };
    await this.queue.client.then((c) => c.set(RATE_LIMIT_KEY, JSON.stringify(state)));
    await this.queue.pause();
    this.scheduleResume(effective);
    this.logger.warn(`enrichment queue paused until ${effective.toISOString()}`);
  }

  async resume(): Promise<void> {
    if (!this.queue) throw new Error('RateLimitService not initialised');
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    await this.queue.client.then((c) => c.del(RATE_LIMIT_KEY)).catch(() => undefined);
    await this.queue.resume();
    this.logger.log('enrichment queue resumed');
  }

  async isPaused(): Promise<boolean> {
    if (!this.queue) return false;
    return this.queue.isPaused();
  }

  async getResetAt(): Promise<Date | null> {
    if (!this.queue) return null;
    const raw = await this.queue.client.then((c) => c.get(RATE_LIMIT_KEY));
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as RateLimitState;
      return new Date(state.resetAt);
    } catch {
      return null;
    }
  }

  private scheduleResume(resetAt: Date): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    const delay = Math.max(1000, resetAt.getTime() - Date.now());
    this.resumeTimer = setTimeout(() => {
      this.resume().catch((err) => {
        this.logger.error(
          `failed to resume enrichment queue: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, delay);
    this.resumeTimer.unref?.();
  }
}
