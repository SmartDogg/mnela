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

  /**
   * Invalidate every active session for a user except `keepId`. Used after
   * a password change so a stolen cookie can't outlive the rotation. We
   * SCAN the namespace rather than keep a per-user index because session
   * counts per admin stay in single digits in practice — a SCAN MATCH +
   * MGET is cheaper than maintaining a parallel Set on every login.
   */
  async destroyAllForUserExcept(adminUserId: string, keepId: string): Promise<number> {
    const prefix = 'mnela:session:';
    const stream = this.redis.client.scanStream({ match: `${prefix}*`, count: 100 });
    const toDelete: string[] = [];
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length === 0) continue;
      const values = await this.redis.client.mget(...keys);
      keys.forEach((k, i) => {
        const raw = values[i];
        if (!raw) return;
        try {
          const payload = JSON.parse(raw) as SessionPayload;
          if (payload.adminUserId === adminUserId && k !== this.key(keepId)) {
            toDelete.push(k);
          }
        } catch {
          /* drop malformed sessions silently — they'll TTL out anyway */
        }
      });
    }
    if (toDelete.length > 0) {
      await this.redis.client.del(...toDelete);
    }
    return toDelete.length;
  }
}
