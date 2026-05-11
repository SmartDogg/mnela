import type { Redis } from 'ioredis';

/**
 * Redis-backed source of truth for whisper.cpp availability — mirrors the
 * Claude status pattern (ADR-0029). Written by the worker's whisper boot probe
 * + per-request error path; read by the worker's enqueue gate and the api's
 * GET /system/whisper-status route.
 */

export const WHISPER_STATUS_KEY = 'mnela:whisper:status';

export type WhisperUnavailableReason =
  | 'not-enabled'
  | 'container-down'
  | 'model-not-loaded'
  | 'request-failed';

export interface WhisperStatusState {
  available: boolean;
  reason?: WhisperUnavailableReason;
  checkedAt: string;
  version?: string;
  model?: string;
}

export const DEFAULT_WHISPER_STATUS: WhisperStatusState = {
  available: false,
  reason: 'not-enabled',
  checkedAt: new Date(0).toISOString(),
};

export async function readWhisperStatus(redis: Redis): Promise<WhisperStatusState> {
  const raw = await redis.get(WHISPER_STATUS_KEY);
  if (!raw) return DEFAULT_WHISPER_STATUS;
  try {
    const parsed = JSON.parse(raw) as WhisperStatusState;
    if (typeof parsed.available !== 'boolean' || typeof parsed.checkedAt !== 'string') {
      return DEFAULT_WHISPER_STATUS;
    }
    return parsed;
  } catch {
    return DEFAULT_WHISPER_STATUS;
  }
}

export async function writeWhisperStatus(redis: Redis, state: WhisperStatusState): Promise<void> {
  await redis.set(WHISPER_STATUS_KEY, JSON.stringify(state));
}
