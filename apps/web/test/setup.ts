import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// next-intl uses next/navigation under the hood in some surfaces.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Stub next-intl: return the key itself as the translation. Tests check
// behavior, not copy; keys come back through both `t('foo')` and `t.rich`.
vi.mock('next-intl', () => {
  const translator = (key: string, values?: Record<string, unknown>) => {
    if (!values || Object.keys(values).length === 0) return key;
    return `${key}(${Object.entries(values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(',')})`;
  };
  const factory = () => translator;
  return {
    useTranslations: factory,
    useFormatter: () => ({ dateTime: (d: Date) => d.toISOString(), number: (n: number) => `${n}` }),
    useLocale: () => 'en',
  };
});
