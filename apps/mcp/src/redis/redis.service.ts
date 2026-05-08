import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { loadEnv } from '../env.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const env = loadEnv();
    this.client = new Redis(env.REDIS_URL, { lazyConnect: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log(`connected to ${this.client.options.host}:${this.client.options.port}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
