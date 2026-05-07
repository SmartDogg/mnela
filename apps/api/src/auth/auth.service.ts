import crypto from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminUserRepository, AuthTokenRepository } from '@mnela/db';
import type { AdminUser, AuthToken } from '@prisma/client';
import argon2 from 'argon2';

import { SessionStore } from './session.store.js';
import type { TokenScope } from './types.js';

const TOKEN_PREFIX = 'mn_';

export interface LoginResult {
  sessionId: string;
  ttlSeconds: number;
  adminUser: AdminUser;
}

export interface CreateTokenInput {
  name: string;
  scope: TokenScope;
  expiresInDays?: number;
}

export interface CreatedToken {
  plaintext: string;
  record: AuthToken;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly tokens: AuthTokenRepository,
    private readonly sessions: SessionStore,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.admins.findByUsername(username);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    await this.admins.touchLastLogin(user.id);
    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, ttlSeconds: session.ttlSeconds, adminUser: user };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId);
  }

  async findAdmin(id: string): Promise<AdminUser | null> {
    return this.admins.findById(id);
  }

  async createToken(input: CreateTokenInput): Promise<CreatedToken> {
    const raw = crypto.randomBytes(32).toString('base64url');
    const plaintext = `${TOKEN_PREFIX}${raw}`;
    const tokenHash = sha256Hex(plaintext);
    const expiresAt =
      input.expiresInDays !== undefined
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;
    const record = await this.tokens.create({
      name: input.name,
      tokenHash,
      scope: input.scope,
      expiresAt,
    });
    return { plaintext, record };
  }

  async validateToken(plaintext: string): Promise<AuthToken | null> {
    if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = sha256Hex(plaintext);
    const record = await this.tokens.findByHash(tokenHash);
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;
    void this.tokens.touchLastUsed(record.id).catch(() => undefined);
    return record;
  }

  async revokeToken(id: string): Promise<AuthToken> {
    return this.tokens.revoke(id);
  }

  async listTokens(): Promise<AuthToken[]> {
    return this.tokens.list();
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
