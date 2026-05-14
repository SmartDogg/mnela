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
// NextIntlClientProvider is exported as a pass-through so component tests
// that wrap their tree in it (because that's what production code expects)
// don't crash on a missing export — the inner `useTranslations` still hits
// our key-as-translation stub, ignoring any `messages` prop the test
// passes in.
vi.mock('next-intl', () => {
  const translator = (key: string, values?: Record<string, unknown>) => {
    if (!values || Object.keys(values).length === 0) return key;
    return `${key}(${Object.entries(values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(',')})`;
  };
  const factory = () => translator;
  const NextIntlClientProvider = ({ children }: { children: React.ReactNode }) => children;
  return {
    useTranslations: factory,
    useFormatter: () => ({ dateTime: (d: Date) => d.toISOString(), number: (n: number) => `${n}` }),
    useLocale: () => 'en',
    NextIntlClientProvider,
  };
});
