import { describe, expect, it } from 'vitest';

import { detectLanguage } from '../language.js';

describe('detectLanguage', () => {
  it('returns null on empty / non-letter input', () => {
    expect(detectLanguage('')).toBeNull();
    expect(detectLanguage('1234 !!! 5678')).toBeNull();
  });

  it('detects mostly cyrillic as ru', () => {
    expect(detectLanguage('Привет мир, как дела?')).toBe('ru');
  });

  it('detects mostly latin as en', () => {
    expect(detectLanguage('Hello world how are you today')).toBe('en');
  });

  it('detects mixed input', () => {
    expect(detectLanguage('Привет Hello мир world hi')).toBe('mixed');
  });
});
