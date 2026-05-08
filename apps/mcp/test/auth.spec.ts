import type { AuthToken } from '@prisma/client';
import { AuthTokenRepository } from '@mnela/db';
import { describe, expect, it, vi } from 'vitest';

import { AuthService, sha256Hex } from '../src/auth/auth.service.js';

function makeAuthToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    id: 'tok_1',
    name: 'test',
    tokenHash: 'unused',
    scope: 'mcp',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<AuthTokenRepository> = {}): AuthTokenRepository {
  const repo: Partial<AuthTokenRepository> = {
    findByHash: vi.fn(async () => null),
    touchLastUsed: vi.fn(async () => makeAuthToken()),
    ...overrides,
  };
  return repo as AuthTokenRepository;
}

describe('AuthService.validateToken', () => {
  it('returns null for an unknown token (findByHash → null)', async () => {
    const repo = makeRepo();
    const svc = new AuthService(repo);
    const result = await svc.validateToken('mn_does_not_exist');
    expect(result).toBeNull();
    expect(repo.findByHash).toHaveBeenCalledWith(sha256Hex('mn_does_not_exist'));
  });

  it('returns null for a revoked token', async () => {
    const record = makeAuthToken({ revokedAt: new Date('2026-04-01T00:00:00Z') });
    const repo = makeRepo({ findByHash: vi.fn(async () => record) });
    const svc = new AuthService(repo);
    expect(await svc.validateToken('mn_revoked')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const record = makeAuthToken({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    const repo = makeRepo({ findByHash: vi.fn(async () => record) });
    const svc = new AuthService(repo);
    expect(await svc.validateToken('mn_expired')).toBeNull();
  });

  it('returns a Principal for a valid token and fires touchLastUsed', async () => {
    const record = makeAuthToken({
      id: 'tok_valid',
      name: 'mcp-runner',
      scope: 'mcp',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    const touchLastUsed = vi.fn(async () => record);
    const repo = makeRepo({ findByHash: vi.fn(async () => record), touchLastUsed });
    const svc = new AuthService(repo);

    const principal = await svc.validateToken('mn_valid');
    expect(principal).toEqual({
      kind: 'token',
      id: 'tok_valid',
      scope: 'mcp',
      name: 'mcp-runner',
    });
    // touchLastUsed is fire-and-forget; await a microtask to let the void
    // promise schedule before asserting.
    await Promise.resolve();
    expect(touchLastUsed).toHaveBeenCalledWith('tok_valid');
  });

  it('swallows touchLastUsed failures (best-effort)', async () => {
    const record = makeAuthToken({ scope: 'admin' });
    const touchLastUsed = vi.fn(async () => {
      throw new Error('db down');
    });
    const repo = makeRepo({ findByHash: vi.fn(async () => record), touchLastUsed });
    const svc = new AuthService(repo);
    await expect(svc.validateToken('mn_ok')).resolves.toMatchObject({ scope: 'admin' });
  });

  it('returns null for an empty token string', async () => {
    const repo = makeRepo();
    const svc = new AuthService(repo);
    expect(await svc.validateToken('')).toBeNull();
    expect(repo.findByHash).not.toHaveBeenCalled();
  });
});
