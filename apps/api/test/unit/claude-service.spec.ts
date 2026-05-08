import { CLAUDE_STATUS_KEY, type ClaudeStatusState } from '@mnela/queue';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claudeAvailableMock = vi.fn();
const claudeTestMock = vi.fn();

vi.mock('@mnela/claude-runner', () => ({
  claudeAvailable: claudeAvailableMock,
  claudeTest: claudeTestMock,
}));

const { ClaudeService } = await import('../../src/modules/system/claude.service.js');

interface FakeRedisStore {
  state: { value: string | null };
  publishedChannels: [string, string][];
}

function fakeRedis(): { redis: Redis; store: FakeRedisStore } {
  const state: { value: string | null } = { value: null };
  const publishedChannels: [string, string][] = [];
  const redis = {
    get: vi.fn(async (key: string) => (key === CLAUDE_STATUS_KEY ? state.value : null)),
    set: vi.fn(async (key: string, value: string) => {
      if (key === CLAUDE_STATUS_KEY) state.value = value;
      return 'OK';
    }),
    publish: vi.fn(async (channel: string, payload: string) => {
      publishedChannels.push([channel, payload]);
      return 1;
    }),
  } as unknown as Redis;
  return { redis, store: { state, publishedChannels } };
}

beforeEach(() => {
  claudeAvailableMock.mockReset();
  claudeTestMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeService', () => {
  it('returns DEFAULT state when redis has no key', async () => {
    const { redis } = fakeRedis();
    const svc = new ClaudeService({ client: redis } as never);
    const state = await svc.getStatus();
    expect(state.available).toBe(false);
    expect(state.reason).toBe('orchestrator-not-running');
  });

  it('runTest persists no-binary when claude is missing and emits the event', async () => {
    claudeAvailableMock.mockResolvedValueOnce(false);
    const { redis, store } = fakeRedis();
    const svc = new ClaudeService({ client: redis } as never);

    const out = await svc.runTest();
    expect(out.ok).toBe(false);
    expect(store.state.value).not.toBeNull();
    const stored = JSON.parse(store.state.value!) as ClaudeStatusState;
    expect(stored.available).toBe(false);
    expect(stored.reason).toBe('no-binary');
    expect(store.publishedChannels).toHaveLength(1);
    expect(store.publishedChannels[0]?.[0]).toBe('mnela:events');
  });

  it('runTest persists available + version when claude is logged in', async () => {
    claudeAvailableMock.mockResolvedValueOnce(true);
    claudeTestMock.mockResolvedValueOnce({
      ok: true,
      version: '1.5.2',
      loggedIn: true,
      latencyMs: 42,
    });
    const { redis, store } = fakeRedis();
    const svc = new ClaudeService({ client: redis } as never);

    const out = await svc.runTest();
    expect(out.ok).toBe(true);
    expect(out.version).toBe('1.5.2');
    const stored = JSON.parse(store.state.value!) as ClaudeStatusState;
    expect(stored.available).toBe(true);
    expect(stored.version).toBe('1.5.2');
  });

  it('runTest persists not-logged-in reason when auth fails', async () => {
    claudeAvailableMock.mockResolvedValueOnce(true);
    claudeTestMock.mockResolvedValueOnce({
      ok: false,
      version: '1.5.2',
      loggedIn: false,
      error: 'Please run /login',
      latencyMs: 12,
    });
    const { redis, store } = fakeRedis();
    const svc = new ClaudeService({ client: redis } as never);

    const out = await svc.runTest();
    expect(out.ok).toBe(false);
    const stored = JSON.parse(store.state.value!) as ClaudeStatusState;
    expect(stored.reason).toBe('not-logged-in');
  });
});
