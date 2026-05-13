import { describe, expect, it } from 'vitest';

import {
  batchSignature,
  clusterSignature,
  docCountBucket,
  isValidSignatureMetrics,
  shouldRevive,
} from '../signature.js';

describe('docCountBucket', () => {
  it('buckets across the documented thresholds', () => {
    expect(docCountBucket(0)).toBe('0-4');
    expect(docCountBucket(4)).toBe('0-4');
    expect(docCountBucket(5)).toBe('5-9');
    expect(docCountBucket(10)).toBe('10-19');
    expect(docCountBucket(20)).toBe('20-49');
    expect(docCountBucket(50)).toBe('50-99');
    expect(docCountBucket(100)).toBe('100-249');
    expect(docCountBucket(250)).toBe('250-499');
    expect(docCountBucket(500)).toBe('500+');
    expect(docCountBucket(10_000)).toBe('500+');
  });
});

describe('batchSignature', () => {
  it('hardcodes a stable shape', () => {
    expect(batchSignature('abc')).toBe('batch:abc');
  });
});

describe('clusterSignature', () => {
  it('is invariant under entity-id ordering', () => {
    const a = clusterSignature(['x', 'y', 'z'], 12);
    const b = clusterSignature(['z', 'x', 'y'], 12);
    expect(a).toBe(b);
  });

  it('produces different signatures across doc-count buckets', () => {
    const small = clusterSignature(['x', 'y', 'z'], 5);
    const medium = clusterSignature(['x', 'y', 'z'], 25);
    expect(small).not.toBe(medium);
  });

  it('produces the same signature within a bucket as docs creep up', () => {
    const a = clusterSignature(['x', 'y'], 10);
    const b = clusterSignature(['x', 'y'], 18);
    expect(a).toBe(b);
  });

  it('throws when given no entities', () => {
    expect(() => clusterSignature([], 10)).toThrow();
  });
});

describe('shouldRevive', () => {
  it('revives when doc count grows by ≥50%', () => {
    expect(
      shouldRevive(
        { docCount: 10, topEntities: ['a', 'b', 'c'] },
        { docCount: 15, topEntities: ['a', 'b', 'c'] },
      ),
    ).toBe(true);
  });

  it('does not revive on small doc growth alone', () => {
    expect(
      shouldRevive(
        { docCount: 10, topEntities: ['a', 'b', 'c'] },
        { docCount: 12, topEntities: ['a', 'b', 'c'] },
      ),
    ).toBe(false);
  });

  it('revives when ≥2 new top entities appear', () => {
    expect(
      shouldRevive(
        { docCount: 10, topEntities: ['a', 'b', 'c'] },
        { docCount: 10, topEntities: ['a', 'b', 'c', 'd', 'e'] },
      ),
    ).toBe(true);
  });

  it('does not revive on a single new entity', () => {
    expect(
      shouldRevive(
        { docCount: 10, topEntities: ['a', 'b', 'c'] },
        { docCount: 10, topEntities: ['a', 'b', 'c', 'd'] },
      ),
    ).toBe(false);
  });

  it('requires a minimum of 3 new docs when previous count is tiny', () => {
    // previous=4 → threshold = max(3, ceil(4*0.5)=2) = 3. +2 docs (4→6) is NOT enough.
    expect(
      shouldRevive(
        { docCount: 4, topEntities: ['a', 'b'] },
        { docCount: 6, topEntities: ['a', 'b'] },
      ),
    ).toBe(false);
    expect(
      shouldRevive(
        { docCount: 4, topEntities: ['a', 'b'] },
        { docCount: 7, topEntities: ['a', 'b'] },
      ),
    ).toBe(true);
  });
});

describe('isValidSignatureMetrics', () => {
  it('accepts valid payloads', () => {
    expect(isValidSignatureMetrics({ docCount: 4, topEntities: ['a', 'b'] })).toBe(true);
  });

  it('rejects junk', () => {
    expect(isValidSignatureMetrics(null)).toBe(false);
    expect(isValidSignatureMetrics('hi')).toBe(false);
    expect(isValidSignatureMetrics({ docCount: 'x', topEntities: [] })).toBe(false);
    expect(isValidSignatureMetrics({ docCount: 4, topEntities: 'a' })).toBe(false);
    expect(isValidSignatureMetrics({ docCount: 4, topEntities: [1, 2] })).toBe(false);
  });
});
