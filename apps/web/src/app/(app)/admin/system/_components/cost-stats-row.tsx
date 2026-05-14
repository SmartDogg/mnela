'use client';

import { useQuery } from '@tanstack/react-query';
import { DollarSign, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CostStats {
  last7d: number;
  last30d: number;
  byProvider: { providerId: string | null; model: string | null; costUsd: number }[];
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

/**
 * Cost telemetry pulled from Message.costUsd. The numbers come from the
 * per-model rate table in apps/api/src/modules/search/cost-rates.ts —
 * CLI-backed turns and pre-Phase-11 messages contribute zero (their
 * cost is null). Show the top 5 model rows in a flat list so the
 * operator sees "where is the money going" without opening a dialog.
 */
export function CostStatsRow(): JSX.Element {
  const t = useTranslations('admin.providers.cost');
  const q = useQuery({
    queryKey: ['admin', 'cost-stats'],
    queryFn: () => api.get<CostStats>('/system/cost-stats'),
    staleTime: 60_000,
  });

  if (q.isError) return <></>;

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          <DollarSign className="size-3.5 text-emerald-500" />
          <span>{t('title')}</span>
        </div>
        {q.isLoading ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="font-mono tabular-nums">{fmtUsd(q.data?.last7d ?? 0)}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t('last7d')}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono tabular-nums">{fmtUsd(q.data?.last30d ?? 0)}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t('last30d')}
              </span>
            </div>
          </>
        )}
      </div>
      {q.data && q.data.byProvider.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border/60 pt-2 text-[11px]">
          {q.data.byProvider.slice(0, 5).map((row, i) => (
            <li
              key={`${row.providerId ?? 'unk'}-${row.model ?? 'unk'}-${i}`}
              className={cn('flex items-center justify-between gap-3')}
            >
              <span className="truncate font-mono text-muted-foreground">
                {row.model ?? t('unknownModel')}
              </span>
              <span className="font-mono tabular-nums">{fmtUsd(row.costUsd)}</span>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.byProvider.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t('empty')}</p>
      )}
    </div>
  );
}
