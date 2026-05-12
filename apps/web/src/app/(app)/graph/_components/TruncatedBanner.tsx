'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { OVERVIEW_LIMIT_PRESETS } from './filterState';

interface TruncatedBannerProps {
  returnedNodes: number;
  totalNodes: number;
  /** Current overview limit (0 = "All"). Hides the CTA when already unlimited. */
  currentLimit?: number;
  /** Called with the next preset above the current one. Hidden when undefined. */
  onShowMore?: (nextLimit: number) => void;
}

export function TruncatedBanner({
  returnedNodes,
  totalNodes,
  currentLimit,
  onShowMore,
}: TruncatedBannerProps): JSX.Element {
  const t = useTranslations('graph');
  const nextPreset = nextPresetAbove(currentLimit);
  const canShowMore = onShowMore !== undefined && nextPreset !== null;

  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-mono tabular-nums">
        {t('truncated', { returned: returnedNodes, total: totalNodes })}
      </span>
      {canShowMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px] text-amber-100 hover:bg-amber-500/20"
          onClick={() => onShowMore(nextPreset)}
        >
          {nextPreset === 0 ? t('showAll') : t('showMore', { next: nextPreset })}
        </Button>
      )}
    </div>
  );
}

/** Pick the next bigger preset above `current`, or 0 (All) if none. Null = at max. */
function nextPresetAbove(current: number | undefined): number | null {
  if (current === undefined) return null;
  if (current === 0) return null; // already unlimited
  const bigger = OVERVIEW_LIMIT_PRESETS.filter((p) => p === 0 || p > current);
  return bigger[0] ?? null;
}
