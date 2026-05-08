import { describe, expect, it } from 'vitest';

import { parseRateLimitReset } from '../parse-rate-limit.js';

describe('parseRateLimitReset', () => {
  const monday = new Date('2026-05-04T10:30:00.000Z'); // Monday
  // Anchor "now" using local time of a known Monday so the relative-day
  // arithmetic is deterministic regardless of the test runner's TZ.
  function anchor(localDateIso: string): Date {
    return new Date(localDateIso);
  }

  it('returns null when no marker matches', () => {
    expect(parseRateLimitReset('all good', monday)).toBeNull();
    expect(parseRateLimitReset('rate limit later', monday)).toBeNull();
  });

  it('parses short-form afternoon time', () => {
    const now = anchor('2026-05-04T08:30:00.000');
    const reset = parseRateLimitReset("You've hit your session limit · resets 3:45pm", now);
    expect(reset).not.toBeNull();
    expect(reset!.getHours()).toBe(15);
    expect(reset!.getMinutes()).toBe(45);
  });

  it('rolls over to tomorrow when target time is already past', () => {
    const now = anchor('2026-05-04T22:00:00.000');
    const reset = parseRateLimitReset("You've hit your session limit · resets 9:00am", now);
    expect(reset).not.toBeNull();
    expect(reset!.getDate()).toBe(5);
    expect(reset!.getHours()).toBe(9);
  });

  it('handles 12am as midnight', () => {
    const now = anchor('2026-05-04T20:00:00.000');
    const reset = parseRateLimitReset("You've hit your weekly limit · resets 12:00am", now);
    expect(reset).not.toBeNull();
    expect(reset!.getHours()).toBe(0);
    expect(reset!.getMinutes()).toBe(0);
  });

  it('handles 12pm as noon', () => {
    const now = anchor('2026-05-04T08:00:00.000');
    const reset = parseRateLimitReset("You've hit your weekly limit · resets 12:30pm", now);
    expect(reset).not.toBeNull();
    expect(reset!.getHours()).toBe(12);
    expect(reset!.getMinutes()).toBe(30);
  });

  it('parses weekday form, picks next occurrence', () => {
    const now = anchor('2026-05-04T08:00:00.000'); // Monday
    const reset = parseRateLimitReset("You've hit your weekly limit · resets Mon 12:00am", now);
    expect(reset).not.toBeNull();
    // Same weekday but earlier in the day → push 7 days forward
    expect(reset!.getDay()).toBe(1);
    expect(reset!.getDate()).toBe(11);
  });

  it('parses weekday form, returns same day when target is later', () => {
    const now = anchor('2026-05-04T08:00:00.000'); // Monday
    const reset = parseRateLimitReset("You've hit your weekly limit · resets Wed 9:00am", now);
    expect(reset).not.toBeNull();
    expect(reset!.getDay()).toBe(3);
    expect(reset!.getDate()).toBe(6);
  });
});
