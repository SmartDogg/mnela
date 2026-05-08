import { describe, expect, it } from 'vitest';

import {
  BACKOFF_CURVE_MS,
  BACKOFF_JITTER_RATIO,
  nextDelayMs,
  nextDelayMsDeterministic,
} from '../backoff';

describe('nextDelayMsDeterministic', () => {
  it('matches the documented curve', () => {
    expect(nextDelayMsDeterministic(0)).toBe(1_000);
    expect(nextDelayMsDeterministic(1)).toBe(2_000);
    expect(nextDelayMsDeterministic(2)).toBe(5_000);
    expect(nextDelayMsDeterministic(3)).toBe(15_000);
    expect(nextDelayMsDeterministic(4)).toBe(60_000);
  });

  it('caps at 60s for high attempts', () => {
    expect(nextDelayMsDeterministic(5)).toBe(60_000);
    expect(nextDelayMsDeterministic(99)).toBe(60_000);
  });

  it('clamps negative or NaN to the first step', () => {
    expect(nextDelayMsDeterministic(-1)).toBe(1_000);
    expect(nextDelayMsDeterministic(Number.NaN)).toBe(1_000);
  });

  it('exposes the same curve as the constant', () => {
    expect(BACKOFF_CURVE_MS).toEqual([1_000, 2_000, 5_000, 15_000, 60_000]);
  });
});

describe('nextDelayMs (jittered)', () => {
  it('returns the base when rng returns 0.5 (jitter centered on 0)', () => {
    expect(nextDelayMs(0, () => 0.5)).toBe(1_000);
    expect(nextDelayMs(2, () => 0.5)).toBe(5_000);
  });

  it('stays within ±20% of the base', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const base = nextDelayMsDeterministic(attempt);
      const max = Math.round(base * (1 + BACKOFF_JITTER_RATIO));
      const min = Math.round(base * (1 - BACKOFF_JITTER_RATIO));
      expect(nextDelayMs(attempt, () => 1)).toBeLessThanOrEqual(max);
      expect(nextDelayMs(attempt, () => 0)).toBeGreaterThanOrEqual(min);
    }
  });

  it('never returns negative values', () => {
    expect(nextDelayMs(0, () => 0)).toBeGreaterThanOrEqual(0);
    expect(nextDelayMs(4, () => 0)).toBeGreaterThanOrEqual(0);
  });
});
