import crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';

interface SessionPayload {
  adminUserId: string;
  createdAt: number;
}

@Injectable()
export class SessionStore {
  private readonly ttlSeconds: number;

  constructor(private readonly redis: RedisService) {
    this.ttlSeconds = loadEnv().SESSION_TTL_SECONDS;
  }

  private key(id: string): string {
    return `mnela:session:${id}`;
  }

  async create(adminUserId: string): Promise<{ id: string; ttlSeconds: number }> {
    const id = crypto.randomBytes(32).toString('base64url');
    const payload: SessionPayload = { adminUserId, createdAt: Date.now() };
    await this.redis.client.set(this.key(id), JSON.stringify(payload), 'EX', this.ttlSeconds);
    return { id, ttlSeconds: this.ttlSeconds };
  }

  async get(id: string): Promise<SessionPayload | null> {
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    await this.redis.client.del(this.key(id));
  }
}
