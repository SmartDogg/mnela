'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClear: () => void;
  isPending: boolean;
}

export function BulkActionBar({
  selectedCount,
  onAcceptAll,
  onRejectAll,
  onClear,
  isPending,
}: BulkActionBarProps): JSX.Element | null {
  const t = useTranslations('inbox.bulk');

  if (selectedCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-full border border-border/80 bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">{t('selected', { count: selectedCount })}</span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onRejectAll}
          disabled={isPending}
          className="h-8 px-3"
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
          <span className="ml-1.5 text-xs">{t('rejectAll')}</span>
        </Button>
        <Button size="sm" onClick={onAcceptAll} disabled={isPending} className="h-8 px-3">
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          <span className="ml-1.5 text-xs">{t('acceptAll')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} className="h-8 px-2">
          <span className="text-xs">{t('clearSelection')}</span>
        </Button>
      </div>
    </div>
  );
}
