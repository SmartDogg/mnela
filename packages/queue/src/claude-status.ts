import type { Redis } from 'ioredis';

/**
 * Single Redis-backed source of truth for Claude availability (ADR-0029).
 * Read by ingestion-consumer (gate enrichment enqueue), api (/system/claude-status),
 * orchestrator (pipeline guard). Written by orchestrator boot, /system/claude-test,
 * and the enrichment pipeline on rate-limit detection.
 */

export const CLAUDE_STATUS_KEY = 'mnela:claude:status';

export type ClaudeUnavailableReason =
  | 'no-binary'
  | 'not-logged-in'
  | 'rate-limit'
  | 'orchestrator-not-running';

export interface ClaudeStatusState {
  available: boolean;
  reason?: ClaudeUnavailableReason;
  checkedAt: string;
  resetAt?: string;
  version?: string;
}

export const DEFAULT_CLAUDE_STATUS: ClaudeStatusState = {
  available: false,
  reason: 'orchestrator-not-running',
  checkedAt: new Date(0).toISOString(),
};

export async function readClaudeStatus(redis: Redis): Promise<ClaudeStatusState> {
  const raw = await redis.get(CLAUDE_STATUS_KEY);
  if (!raw) return DEFAULT_CLAUDE_STATUS;
  try {
    const parsed = JSON.parse(raw) as ClaudeStatusState;
    if (typeof parsed.available !== 'boolean' || typeof parsed.checkedAt !== 'string') {
      return DEFAULT_CLAUDE_STATUS;
    }
    return parsed;
  } catch {
    return DEFAULT_CLAUDE_STATUS;
  }
}

export async function writeClaudeStatus(redis: Redis, state: ClaudeStatusState): Promise<void> {
  await redis.set(CLAUDE_STATUS_KEY, JSON.stringify(state));
}
