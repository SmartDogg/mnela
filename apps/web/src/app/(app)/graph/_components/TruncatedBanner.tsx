'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface TruncatedBannerProps {
  returnedNodes: number;
  totalNodes: number;
}

export function TruncatedBanner({ returnedNodes, totalNodes }: TruncatedBannerProps): JSX.Element {
  const t = useTranslations('graph');
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-mono tabular-nums">
        {t('truncated', { returned: returnedNodes, total: totalNodes })}
      </span>
    </div>
  );
}
