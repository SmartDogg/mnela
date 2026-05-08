import { describe, expect, it } from 'vitest';

import { errorRateTone, formatBucketTs, formatMs } from './format';

describe('formatMs', () => {
  it('formats sub-second as ms', () => {
    expect(formatMs(0)).toBe('0ms');
    expect(formatMs(42)).toBe('42ms');
    expect(formatMs(999)).toBe('999ms');
  });

  it('formats seconds with two decimals', () => {
    expect(formatMs(1000)).toBe('1.00s');
    expect(formatMs(2500)).toBe('2.50s');
    expect(formatMs(59_999)).toBe('60.00s');
  });

  it('formats minutes', () => {
    expect(formatMs(60_000)).toBe('1.00m');
    expect(formatMs(90_000)).toBe('1.50m');
  });

  it('formats hours', () => {
    expect(formatMs(3_600_000)).toBe('1.00h');
    expect(formatMs(5_400_000)).toBe('1.50h');
  });
});

describe('formatBucketTs', () => {
  it('zero-pads HH:MM in local time', () => {
    const d = new Date(2025, 0, 1, 9, 5, 0);
    expect(formatBucketTs(d.toISOString())).toBe('09:05');
  });
});

describe('errorRateTone', () => {
  it('returns ok below 1%', () => {
    expect(errorRateTone(0)).toBe('ok');
    expect(errorRateTone(0.0099)).toBe('ok');
  });

  it('returns warn between 1% and 5%', () => {
    expect(errorRateTone(0.01)).toBe('warn');
    expect(errorRateTone(0.0499)).toBe('warn');
  });

  it('returns bad at 5% and above', () => {
    expect(errorRateTone(0.05)).toBe('bad');
    expect(errorRateTone(1)).toBe('bad');
  });
});
