// Reconnect schedule for Socket.io. Curve: 1s, 2s, 5s, 15s, 60s (capped).
// Real callers use `nextDelayMs` (with ±20% jitter so retries don't herd).
// Tests use `nextDelayMsDeterministic` to assert the curve without RNG.

const CURVE_MS: readonly number[] = [1_000, 2_000, 5_000, 15_000, 60_000];
const JITTER_RATIO = 0.2;

export function nextDelayMsDeterministic(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return CURVE_MS[0] ?? 1_000;
  const idx = Math.min(Math.floor(attempt), CURVE_MS.length - 1);
  return CURVE_MS[idx] ?? CURVE_MS[CURVE_MS.length - 1] ?? 60_000;
}

export function nextDelayMs(attempt: number, rng: () => number = Math.random): number {
  const base = nextDelayMsDeterministic(attempt);
  const jitter = (rng() * 2 - 1) * JITTER_RATIO * base;
  return Math.max(0, Math.round(base + jitter));
}

export const BACKOFF_CURVE_MS = CURVE_MS;
export const BACKOFF_JITTER_RATIO = JITTER_RATIO;
