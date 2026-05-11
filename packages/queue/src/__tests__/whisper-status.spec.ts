import { type Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WHISPER_STATUS,
  WHISPER_STATUS_KEY,
  readWhisperStatus,
  writeWhisperStatus,
  type WhisperStatusState,
} from '../whisper-status.js';

function fakeRedis(getResult: string | null): { redis: Redis; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async () => getResult);
  return { redis: { get } as unknown as Redis, get };
}

describe('whisper-status', () => {
  it('returns DEFAULT_WHISPER_STATUS when key is missing', async () => {
    const { redis, get } = fakeRedis(null);
    const state = await readWhisperStatus(redis);
    expect(get).toHaveBeenCalledWith(WHISPER_STATUS_KEY);
    expect(state).toEqual(DEFAULT_WHISPER_STATUS);
  });

  it('returns DEFAULT_WHISPER_STATUS on malformed JSON', async () => {
    const { redis } = fakeRedis('{not json');
    const state = await readWhisperStatus(redis);
    expect(state).toEqual(DEFAULT_WHISPER_STATUS);
  });

  it('returns DEFAULT_WHISPER_STATUS when shape is wrong', async () => {
    const { redis } = fakeRedis(JSON.stringify({ available: 'yes', checkedAt: 0 }));
    const state = await readWhisperStatus(redis);
    expect(state).toEqual(DEFAULT_WHISPER_STATUS);
  });

  it('round-trips a real state', async () => {
    const set = vi.fn(async () => 'OK');
    const redis = { set } as unknown as Redis;
    const state: WhisperStatusState = {
      available: true,
      checkedAt: '2026-05-11T10:00:00.000Z',
      model: 'base',
    };
    await writeWhisperStatus(redis, state);
    expect(set).toHaveBeenCalledWith(WHISPER_STATUS_KEY, JSON.stringify(state));
  });

  it('reads a real state back', async () => {
    const stored: WhisperStatusState = {
      available: false,
      reason: 'container-down',
      checkedAt: '2026-05-11T11:00:00.000Z',
      model: 'base',
    };
    const { redis } = fakeRedis(JSON.stringify(stored));
    const state = await readWhisperStatus(redis);
    expect(state).toEqual(stored);
  });
});
