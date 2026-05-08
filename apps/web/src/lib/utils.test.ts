import { describe, expect, it } from 'vitest';

import { cn, formatBytes, relativeTime } from './utils';

describe('cn', () => {
  it('merges tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    const flag = false as boolean;
    expect(cn('text-sm', flag && 'hidden', 'font-bold')).toBe('text-sm font-bold');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
    expect(formatBytes(1024 * 1024 * 1024 * 4)).toBe('4.00 GB');
  });
});

describe('relativeTime', () => {
  it('returns a relative phrase', () => {
    const ago = new Date(Date.now() - 60_000).toISOString();
    expect(relativeTime(ago, 'en')).toMatch(/minute/);
  });
});
