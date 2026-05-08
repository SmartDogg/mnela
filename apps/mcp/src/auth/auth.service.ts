import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { AuthTokenRepository } from '@mnela/db';

import type { Principal, TokenScope } from './types.js';

@Injectable()
export class AuthService {
  constructor(private readonly tokens: AuthTokenRepository) {}

  async validateToken(plaintext: string): Promise<Principal | null> {
    if (!plaintext) return null;
    const tokenHash = sha256Hex(plaintext);
    const record = await this.tokens.findByHash(tokenHash);
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

    // Best-effort lastUsedAt update — never block the request on it, and never
    // surface the failure (telemetry-grade signal, not auth-critical).
    void this.tokens.touchLastUsed(record.id).catch(() => undefined);

    return {
      kind: 'token',
      id: record.id,
      scope: record.scope as TokenScope,
      name: record.name,
    };
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
