import { describe, expect, it } from 'vitest';

import { filtersFromSearchParams, filtersToSearchParams, rangeStart } from './filters';

describe('filtersFromSearchParams', () => {
  it('returns defaults for empty params', () => {
    const f = filtersFromSearchParams(new URLSearchParams());
    expect(f.status).toBe('pending');
    expect(f.range).toBe('all');
    expect(f.type).toBeUndefined();
    expect(f.projectSlug).toBeUndefined();
  });

  it('parses every valid field', () => {
    const params = new URLSearchParams(
      'type=link_suggestion&status=accepted&projectSlug=mnela&range=7d',
    );
    const f = filtersFromSearchParams(params);
    expect(f).toEqual({
      type: 'link_suggestion',
      status: 'accepted',
      projectSlug: 'mnela',
      range: '7d',
    });
  });

  it('falls back to defaults for invalid values', () => {
    const params = new URLSearchParams('type=invalid&status=weird&range=garbage');
    const f = filtersFromSearchParams(params);
    expect(f.type).toBeUndefined();
    expect(f.status).toBe('pending');
    expect(f.range).toBe('all');
  });
});

describe('filtersToSearchParams', () => {
  it('omits defaults from the URL', () => {
    const params = filtersToSearchParams({
      status: 'pending',
      range: 'all',
    });
    expect(params.toString()).toBe('');
  });

  it('emits non-default values', () => {
    const params = filtersToSearchParams({
      type: 'link_suggestion',
      status: 'accepted',
      projectSlug: 'mnela',
      range: '30d',
    });
    expect(params.get('type')).toBe('link_suggestion');
    expect(params.get('status')).toBe('accepted');
    expect(params.get('projectSlug')).toBe('mnela');
    expect(params.get('range')).toBe('30d');
  });
});

describe('rangeStart', () => {
  it('returns null for "all"', () => {
    expect(rangeStart('all')).toBeNull();
  });

  it('returns past timestamps for windows', () => {
    const today = rangeStart('today');
    const sevenD = rangeStart('7d');
    const thirtyD = rangeStart('30d');
    expect(today).toBeInstanceOf(Date);
    expect(sevenD).toBeInstanceOf(Date);
    expect(thirtyD).toBeInstanceOf(Date);
    expect(sevenD!.getTime()).toBeLessThan(Date.now());
    expect(thirtyD!.getTime()).toBeLessThan(sevenD!.getTime());
  });
});
