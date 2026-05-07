import type { AuthToken } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export type TokenScope = 'admin' | 'mcp' | 'read_only';

export interface CreateAuthTokenInput {
  name: string;
  tokenHash: string;
  scope: TokenScope;
  expiresAt?: Date | null;
}

export class AuthTokenRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateAuthTokenInput): Promise<AuthToken> {
    return this.getPrisma().authToken.create({ data: input });
  }

  findByHash(tokenHash: string): Promise<AuthToken | null> {
    return this.getPrisma().authToken.findUnique({ where: { tokenHash } });
  }

  findById(id: string): Promise<AuthToken | null> {
    return this.getPrisma().authToken.findUnique({ where: { id } });
  }

  list(): Promise<AuthToken[]> {
    return this.getPrisma().authToken.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  revoke(id: string): Promise<AuthToken> {
    return this.getPrisma().authToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  touchLastUsed(id: string): Promise<AuthToken> {
    return this.getPrisma().authToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
