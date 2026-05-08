import { type Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_STATUS_KEY,
  DEFAULT_CLAUDE_STATUS,
  readClaudeStatus,
  writeClaudeStatus,
  type ClaudeStatusState,
} from '../claude-status.js';

function fakeRedis(getResult: string | null): { redis: Redis; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async () => getResult);
  return { redis: { get } as unknown as Redis, get };
}

describe('claude-status', () => {
  it('returns DEFAULT_CLAUDE_STATUS when key is missing', async () => {
    const { redis, get } = fakeRedis(null);
    const state = await readClaudeStatus(redis);
    expect(get).toHaveBeenCalledWith(CLAUDE_STATUS_KEY);
    expect(state).toEqual(DEFAULT_CLAUDE_STATUS);
  });

  it('returns DEFAULT_CLAUDE_STATUS on malformed JSON', async () => {
    const { redis } = fakeRedis('{not json');
    const state = await readClaudeStatus(redis);
    expect(state).toEqual(DEFAULT_CLAUDE_STATUS);
  });

  it('returns DEFAULT_CLAUDE_STATUS when shape is wrong', async () => {
    const { redis } = fakeRedis(JSON.stringify({ available: 'yes', checkedAt: 0 }));
    const state = await readClaudeStatus(redis);
    expect(state).toEqual(DEFAULT_CLAUDE_STATUS);
  });

  it('round-trips a real state', async () => {
    const set = vi.fn(async () => 'OK');
    const redis = { set } as unknown as Redis;
    const state: ClaudeStatusState = {
      available: true,
      checkedAt: '2026-05-08T10:00:00.000Z',
      version: '1.5.0',
    };
    await writeClaudeStatus(redis, state);
    expect(set).toHaveBeenCalledWith(CLAUDE_STATUS_KEY, JSON.stringify(state));
  });

  it('reads a real state back', async () => {
    const stored: ClaudeStatusState = {
      available: false,
      reason: 'rate-limit',
      checkedAt: '2026-05-08T11:00:00.000Z',
      resetAt: '2026-05-08T15:45:00.000Z',
    };
    const { redis } = fakeRedis(JSON.stringify(stored));
    const state = await readClaudeStatus(redis);
    expect(state).toEqual(stored);
  });
});
