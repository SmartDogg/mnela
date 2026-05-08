import { describe, expect, it } from 'vitest';

import { namespaceHash, sha256Hex } from '../content-hash.js';

describe('content-hash', () => {
  it('sha256 is deterministic and 64 hex chars', () => {
    const a = sha256Hex('hello');
    expect(a).toBe(sha256Hex('hello'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different input → different hash', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('hello!'));
  });

  it('namespaceHash separates per sub-key', () => {
    const file = sha256Hex('archive content');
    const a = namespaceHash(file, 'conv-1');
    const b = namespaceHash(file, 'conv-2');
    expect(a).not.toBe(b);
    expect(a).toBe(namespaceHash(file, 'conv-1'));
  });
});
