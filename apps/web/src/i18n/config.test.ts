import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale } from './config';

describe('i18n config', () => {
  it('has en as default', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
  it('supports en and ru', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'ru']);
  });
  it('isLocale narrows correctly', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
