import { describe, expect, it } from 'vitest';

import { computeEta, formatEta } from '../eta';

describe('computeEta', () => {
  it('returns null ETA when nothing processed yet', () => {
    expect(computeEta(0, 100, 1_000, 5_000)).toEqual({ etaSeconds: null, ratePerSec: 0 });
  });

  it('returns null ETA when total is unknown', () => {
    const result = computeEta(10, null, 1_000, 11_000);
    expect(result.etaSeconds).toBeNull();
    expect(result.ratePerSec).toBeCloseTo(1, 5);
  });

  it('returns null ETA before startedAtMs', () => {
    expect(computeEta(5, 100, null, 5_000)).toEqual({ etaSeconds: null, ratePerSec: 0 });
    expect(computeEta(5, 100, 5_000, 5_000)).toEqual({ etaSeconds: null, ratePerSec: 0 });
    expect(computeEta(5, 100, 5_000, 4_000)).toEqual({ etaSeconds: null, ratePerSec: 0 });
  });

  it('computes a steady-rate ETA', () => {
    // 10 items in 10 s -> 1 item/s; 90 remaining => 90 s ETA.
    const result = computeEta(10, 100, 1_000, 11_000);
    expect(result.ratePerSec).toBeCloseTo(1, 5);
    expect(result.etaSeconds).toBe(90);
  });

  it('rounds ETA to whole seconds', () => {
    // 3 items in 2 s -> 1.5/s; 7 remaining / 1.5 = 4.666... => 5.
    const result = computeEta(3, 10, 1_000, 3_000);
    expect(result.etaSeconds).toBe(5);
  });

  it('returns 0 when processed equals total', () => {
    const result = computeEta(100, 100, 1_000, 11_000);
    expect(result.etaSeconds).toBeNull();
    expect(result.ratePerSec).toBeCloseTo(10, 5);
  });

  it('clamps negative remainders (overshoot) to null ETA', () => {
    const result = computeEta(120, 100, 1_000, 11_000);
    expect(result.etaSeconds).toBeNull();
  });
});

describe('formatEta', () => {
  it('renders dash when null', () => {
    expect(formatEta(null)).toBe('—');
  });

  it('renders seconds under one minute', () => {
    expect(formatEta(0)).toBe('0s');
    expect(formatEta(45)).toBe('45s');
  });

  it('renders minutes and seconds under one hour', () => {
    expect(formatEta(60)).toBe('1m');
    expect(formatEta(75)).toBe('1m 15s');
    expect(formatEta(3599)).toBe('59m 59s');
  });

  it('renders hours and minutes', () => {
    expect(formatEta(3600)).toBe('1h');
    expect(formatEta(3660)).toBe('1h 1m');
    expect(formatEta(7325)).toBe('2h 2m');
  });
});
