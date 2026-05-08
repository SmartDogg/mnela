import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const mod = (await import(`./messages/${locale}.json`)) as { default: AbstractIntlMessages };
  return { locale, messages: mod.default };
});
