'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function DumbModeBanner(): JSX.Element {
  const t = useTranslations('ask.dumbMode');
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <Info className="size-3.5 shrink-0" />
      <span>{t('banner')}</span>
    </div>
  );
}
