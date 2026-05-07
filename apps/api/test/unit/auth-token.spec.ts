import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../src/auth/auth.service.js';

describe('sha256Hex', () => {
  it('produces 64-char hex digest', () => {
    const hash = sha256Hex('mn_abc123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('same-input')).toBe(sha256Hex('same-input'));
  });

  it('changes with input', () => {
    expect(sha256Hex('mn_one')).not.toBe(sha256Hex('mn_two'));
  });
});
