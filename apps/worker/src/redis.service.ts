import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { loadEnv } from './env.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const env = loadEnv();
    this.client = new Redis(env.REDIS_URL, { lazyConnect: true });
    this.client.on('error', (err) => this.logger.warn(`redis error: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect().catch((err: Error) => {
      this.logger.error(`redis connect failed: ${err.message}`);
      throw err;
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
