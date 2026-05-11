import { describe, expect, it } from 'vitest';

import { sanitizeHighlight } from './sanitize-highlights';

describe('sanitizeHighlight', () => {
  it('keeps <mark> tags', () => {
    expect(sanitizeHighlight('plain <mark>match</mark> text')).toBe(
      'plain <mark>match</mark> text',
    );
  });

  it('strips script tags', () => {
    expect(sanitizeHighlight('<script>alert(1)</script>safe')).toBe('safe');
  });

  it('strips img onerror', () => {
    const out = sanitizeHighlight('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('img');
  });

  it('strips mark attributes', () => {
    const out = sanitizeHighlight('<mark style="background: red" onclick="alert(1)">x</mark>');
    expect(out).toBe('<mark>x</mark>');
  });
});
