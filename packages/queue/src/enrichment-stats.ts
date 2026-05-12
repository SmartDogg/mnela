import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { peekSlot, type SlotOwner } from './slot-lock.js';

/**
 * Redis ZSET of recent enrichment-job completions. Score = completedAtMs,
 * member = "<durationMs>:<dbJobId>". The orchestrator pushes on every
 * pipeline.run() that ends with status=enriched; the api reads the same key
 * to compute throughput/p50 for /jobs without re-querying Postgres on every
 * paint.
 */
export const ENRICHMENT_COMPLETIONS_KEY = 'mnela:enrichment:completions';

/**
 * Redis flag set by the admin "Pause queue" button. Distinct from the
 * RateLimitService's auto-pause so a manual resume doesn't accidentally
 * defeat an active rate-limit window, and vice-versa: clearing the
 * rate-limit doesn't un-pause a manually paused queue.
 */
export const ENRICHMENT_USER_PAUSED_KEY = 'mnela:enrichment:user-paused';

/**
 * Redis key persisted by RateLimitService when it pauses on a Claude
 * rate-limit hit. We read it from both api + orchestrator to surface the
 * reset time in the queue-state payload without duplicating the parse logic.
 * Kept in sync with `RATE_LIMIT_KEY` in apps/orchestrator/.../rate-limit.service.ts.
 */
export const RATE_LIMIT_KEY = 'mnela:claude:rate-limit';

/** One hour, ms — sliding window for completedLastHour + rate stats. */
const HOUR_MS = 60 * 60 * 1000;
/** Trim the ZSET to this many points; covers ~30 docs/min for an hour comfortably. */
const MAX_COMPLETIONS = 5000;

export async function recordEnrichmentCompletion(
  redis: Redis,
  args: { jobId: string; durationMs: number; completedAtMs?: number },
): Promise<void> {
  const completedAt = args.completedAtMs ?? Date.now();
  const member = `${Math.max(0, Math.round(args.durationMs))}:${args.jobId}`;
  // Add the point, then trim by score (older than 1h) and by rank (keep last N).
  await redis
    .multi()
    .zadd(ENRICHMENT_COMPLETIONS_KEY, completedAt, member)
    .zremrangebyscore(ENRICHMENT_COMPLETIONS_KEY, '-inf', `(${completedAt - HOUR_MS}`)
    .zremrangebyrank(ENRICHMENT_COMPLETIONS_KEY, 0, -(MAX_COMPLETIONS + 1))
    .exec();
}

export async function setEnrichmentUserPaused(
  queue: Queue,
  redis: Redis,
  paused: boolean,
): Promise<void> {
  if (paused) {
    await redis.set(ENRICHMENT_USER_PAUSED_KEY, '1');
    await queue.pause();
  } else {
    await redis.del(ENRICHMENT_USER_PAUSED_KEY);
    // Only un-pause the BullMQ queue if no other pause reason (rate-limit) is
    // active. RateLimitService owns its own resume; we just don't fight it.
    const rateLimited = await redis.get(RATE_LIMIT_KEY);
    if (!rateLimited) await queue.resume();
  }
}

export async function readEnrichmentUserPaused(redis: Redis): Promise<boolean> {
  return (await redis.get(ENRICHMENT_USER_PAUSED_KEY)) !== null;
}

export async function readRateLimitedUntil(redis: Redis): Promise<string | null> {
  const raw = await redis.get(RATE_LIMIT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { resetAt: string };
    return parsed.resetAt ?? null;
  } catch {
    return null;
  }
}

export interface EnrichmentSnapshot {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completedLastHour: number;
  ratePerMinute: number;
  p50DurationMs: number;
  parallelism: number;
  useSlot: boolean;
  slotHolder: SlotOwner | null;
  paused: boolean;
  userPaused: boolean;
  rateLimitedUntil: string | null;
}

export interface SnapshotInputs {
  /** Resolved BullMQ "parallelism" — caller reads from SystemConfig. */
  parallelism: number;
  /** Resolved `enrichment.useSlot` — caller reads from SystemConfig. */
  useSlot: boolean;
}

/**
 * Compute the queue-state snapshot from Redis + BullMQ counts. Same code
 * path is used by the orchestrator's tick emitter and the api's
 * `/jobs/queue-state` endpoint so the two views can't drift.
 */
export async function readEnrichmentSnapshot(
  queue: Queue,
  redis: Redis,
  inputs: SnapshotInputs,
): Promise<EnrichmentSnapshot> {
  const [counts, paused, userPaused, rateLimitedUntil, slot] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    queue.isPaused(),
    readEnrichmentUserPaused(redis),
    readRateLimitedUntil(redis),
    peekSlot(redis),
  ]);

  const since = Date.now() - HOUR_MS;
  // ZRANGEBYSCORE returns members as "<durationMs>:<jobId>". We only need the
  // durations for the p50 calc — cheaper than ZRANGE WITHSCORES and avoids
  // pulling scores we already know are in-window.
  const raw = await redis.zrangebyscore(ENRICHMENT_COMPLETIONS_KEY, since, '+inf');
  const durations: number[] = [];
  let lastMinuteCount = 0;
  const sinceMinute = Date.now() - 60_000;
  // Fetch scores alongside members to slice the last-minute subset without
  // a second roundtrip; rangebyscore + withscores comes back as [m, s, m, s, ...].
  const withScores = await redis.zrangebyscore(
    ENRICHMENT_COMPLETIONS_KEY,
    since,
    '+inf',
    'WITHSCORES',
  );
  for (let i = 0; i < withScores.length; i += 2) {
    const member = withScores[i] ?? '';
    const scoreStr = withScores[i + 1] ?? '0';
    const score = Number(scoreStr);
    const colon = member.indexOf(':');
    const duration = colon === -1 ? 0 : Number(member.slice(0, colon));
    if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
    if (Number.isFinite(score) && score >= sinceMinute) lastMinuteCount += 1;
  }
  durations.sort((a, b) => a - b);
  const p50 =
    durations.length === 0 ? 0 : (durations[Math.floor((durations.length - 1) * 0.5)] ?? 0);

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completedLastHour: raw.length,
    ratePerMinute: lastMinuteCount,
    p50DurationMs: Math.round(p50),
    parallelism: inputs.parallelism,
    useSlot: inputs.useSlot,
    slotHolder: slot?.owner ?? null,
    paused,
    userPaused,
    rateLimitedUntil,
  };
}
