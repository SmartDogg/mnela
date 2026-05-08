import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToApiQuery,
  filtersToSearchParams,
  type EntityType,
} from '../filterState';

describe('filtersFromSearchParams', () => {
  it('returns defaults when no params', () => {
    const out = filtersFromSearchParams('');
    expect(out).toEqual(DEFAULT_FILTERS);
  });

  it('parses center, depth, projectSlug', () => {
    const out = filtersFromSearchParams('center=abc&depth=3&projectSlug=mnela');
    expect(out.center).toBe('abc');
    expect(out.depth).toBe(3);
    expect(out.projectSlug).toBe('mnela');
  });

  it('clamps depth into 1..4', () => {
    expect(filtersFromSearchParams('depth=99').depth).toBe(4);
    expect(filtersFromSearchParams('depth=0').depth).toBe(1);
    expect(filtersFromSearchParams('depth=foo').depth).toBe(DEFAULT_FILTERS.depth);
  });

  it('parses comma-separated types and drops unknown values', () => {
    const out = filtersFromSearchParams('types=person,technology,not-a-type');
    expect(out.types).toEqual(['person', 'technology']);
  });

  it('deduplicates types from repeated params', () => {
    const out = filtersFromSearchParams('types=person&types=person,technology');
    expect(out.types).toEqual(['person', 'technology']);
  });

  it('parses relations as a free-form list', () => {
    const out = filtersFromSearchParams('relations=mentions,uses, depends-on ');
    expect(out.relations).toEqual(['mentions', 'uses', 'depends-on']);
  });

  it('clamps confidence to [0..1]', () => {
    expect(filtersFromSearchParams('confidence=2').confidence).toBe(1);
    expect(filtersFromSearchParams('confidence=-1').confidence).toBe(0);
    expect(filtersFromSearchParams('confidence=0.4').confidence).toBeCloseTo(0.4);
  });

  it('parses from/to as ISO date strings, empties become null', () => {
    const out = filtersFromSearchParams('from=2025-01-01&to=');
    expect(out.from).toBe('2025-01-01');
    expect(out.to).toBeNull();
  });

  it('honors confirmedOnly=false explicitly', () => {
    expect(filtersFromSearchParams('confirmedOnly=false').confirmedOnly).toBe(false);
    expect(filtersFromSearchParams('confirmedOnly=true').confirmedOnly).toBe(true);
    expect(filtersFromSearchParams('').confirmedOnly).toBe(true);
  });

  it('round-trips through filtersToSearchParams', () => {
    const original = {
      ...DEFAULT_FILTERS,
      center: 'e1',
      depth: 2,
      types: ['person', 'technology'] as EntityType[],
      relations: ['mentions', 'uses'],
      projectSlug: 'mnela',
      from: '2025-01-01',
      to: '2025-12-31',
      confidence: 0.6,
      confirmedOnly: false,
    };
    const params = filtersToSearchParams(original);
    const parsed = filtersFromSearchParams(params);
    expect(parsed).toEqual(original);
  });
});

describe('filtersToSearchParams', () => {
  it('omits default values', () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS);
    expect(params.toString()).toBe('');
  });

  it('keeps non-defaults compact', () => {
    const params = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      center: 'e1',
      depth: 2,
      confidence: 0.5,
    });
    const s = params.toString();
    expect(s).toContain('center=e1');
    expect(s).toContain('depth=2');
    expect(s).toContain('confidence=0.50');
  });
});

describe('filtersToApiQuery', () => {
  it('returns null when there is no center', () => {
    expect(filtersToApiQuery(DEFAULT_FILTERS)).toBeNull();
  });

  it('serializes types and relations as comma-joined strings', () => {
    const q = filtersToApiQuery({
      ...DEFAULT_FILTERS,
      center: 'e1',
      types: ['person', 'technology'],
      relations: ['mentions', 'uses'],
    });
    expect(q).not.toBeNull();
    expect(q?.types).toBe('person,technology');
    expect(q?.relations).toBe('mentions,uses');
  });

  it('expands from/to into ISO datetimes at day boundaries', () => {
    const q = filtersToApiQuery({
      ...DEFAULT_FILTERS,
      center: 'e1',
      from: '2025-01-01',
      to: '2025-01-31',
    });
    expect(q?.from).toBe('2025-01-01T00:00:00.000Z');
    expect(q?.to).toBe('2025-01-31T23:59:59.999Z');
  });

  it('omits defaults from the query', () => {
    const q = filtersToApiQuery({ ...DEFAULT_FILTERS, center: 'e1' });
    expect(q).toEqual({ center: 'e1' });
  });

  it('only includes confidence when above 0', () => {
    const q = filtersToApiQuery({ ...DEFAULT_FILTERS, center: 'e1', confidence: 0.7 });
    expect(q?.confidence).toBeCloseTo(0.7);
  });
});
