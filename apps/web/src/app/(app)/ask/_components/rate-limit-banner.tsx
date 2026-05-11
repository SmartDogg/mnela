'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function RateLimitBanner({ resetAt }: { resetAt?: string }): JSX.Element {
  const t = useTranslations('ask.rateLimit');
  const formatted = resetAt ? new Date(resetAt).toLocaleString() : '—';
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"
    >
      <AlertCircle className="size-3.5 shrink-0" />
      <span>{t('banner', { resetAt: formatted })}</span>
    </div>
  );
}
