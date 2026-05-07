import { describe, expect, it } from 'vitest';

import { paginationParams, makePage } from '@mnela/db';

describe('paginationParams', () => {
  it('defaults to page 1 limit 20', () => {
    expect(paginationParams()).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
  });

  it('computes skip from page', () => {
    expect(paginationParams({ page: 3, limit: 10 })).toEqual({
      skip: 20,
      take: 10,
      page: 3,
      limit: 10,
    });
  });

  it('clamps limit at 100', () => {
    expect(paginationParams({ limit: 1000 }).limit).toBe(100);
  });

  it('clamps page at 1', () => {
    expect(paginationParams({ page: 0 }).page).toBe(1);
    expect(paginationParams({ page: -5 }).page).toBe(1);
  });
});

describe('makePage', () => {
  it('packages items with metadata', () => {
    const params = paginationParams({ page: 2, limit: 5 });
    const page = makePage([1, 2, 3], 18, params);
    expect(page).toEqual({ items: [1, 2, 3], total: 18, page: 2, limit: 5 });
  });
});
