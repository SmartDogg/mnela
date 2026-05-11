import type { Redis } from 'ioredis';

/**
 * Redis-backed mutual-exclusion lock for the single shared Claude subprocess slot
 * between Ask Brain (interactive, apps/api) and enrichment (background, apps/orchestrator).
 * ADR-0041 — Ask is non-blocking; enrichment yields by re-queueing delayed jobs.
 *
 * The orchestrator never preempts an in-flight enrichment subprocess; it only checks the
 * slot at job pickup. Ask spawns its runClaude immediately and refreshes the TTL while
 * streaming. On done/error/abort it releases via the compare-and-delete Lua script so it
 * never frees someone else's lock.
 */

export const CLAUDE_SLOT_KEY = 'mnela:claude:slot';

export type SlotOwner = 'ask' | 'enrichment';

export interface SlotState {
  owner: SlotOwner;
  acquiredAt: string;
  sessionId: string;
}

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export async function acquireSlot(
  redis: Redis,
  owner: SlotOwner,
  sessionId: string,
  ttlSec: number,
): Promise<boolean> {
  const value = JSON.stringify({ owner, acquiredAt: new Date().toISOString(), sessionId });
  const result = await redis.set(CLAUDE_SLOT_KEY, value, 'EX', ttlSec, 'NX');
  return result === 'OK';
}

export async function refreshSlot(
  redis: Redis,
  sessionId: string,
  ttlSec: number,
): Promise<boolean> {
  const raw = await redis.get(CLAUDE_SLOT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as SlotState;
    if (parsed.sessionId !== sessionId) return false;
    await redis.set(CLAUDE_SLOT_KEY, raw, 'EX', ttlSec, 'XX');
    return true;
  } catch {
    return false;
  }
}

export async function releaseSlot(redis: Redis, sessionId: string): Promise<boolean> {
  const raw = await redis.get(CLAUDE_SLOT_KEY);
  if (!raw) return false;
  const result = (await redis.eval(RELEASE_LUA, 1, CLAUDE_SLOT_KEY, raw)) as number;
  try {
    const parsed = JSON.parse(raw) as SlotState;
    return result === 1 && parsed.sessionId === sessionId;
  } catch {
    return false;
  }
}

export async function peekSlot(redis: Redis): Promise<SlotState | null> {
  const raw = await redis.get(CLAUDE_SLOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SlotState;
    if (typeof parsed.owner !== 'string' || typeof parsed.sessionId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
