'use client';

import { useTranslations } from 'next-intl';

import { JobStatusBadge } from '@/components/status-badge';
import { Progress } from '@/components/ui/progress';
import type { JobSummary } from '@/lib/api/types';

import { formatEta } from './eta';

export interface ProgressCounts {
  processed: number;
  total: number | null;
  skipped: number;
  failed: number;
}

interface ProgressHeaderProps {
  job: JobSummary;
  counts: ProgressCounts;
  etaSeconds: number | null;
  ratePerSec: number;
}

export function ProgressHeader({
  job,
  counts,
  etaSeconds,
  ratePerSec,
}: ProgressHeaderProps): JSX.Element {
  const t = useTranslations('imports.detail');
  const percent =
    counts.total && counts.total > 0
      ? Math.min(100, Math.round((counts.processed / counts.total) * 100))
      : 0;

  return (
    <div className="border-b bg-background/80 px-8 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <JobStatusBadge status={job.status} />
          <span className="text-sm font-medium tabular-nums">
            {counts.processed}
            {counts.total !== null ? ` / ${counts.total}` : ''}
          </span>
          <span className="text-xs text-muted-foreground">({percent}%)</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
          <Stat label={t('skipped')} value={counts.skipped} tone="muted" />
          <Stat
            label={t('failed')}
            value={counts.failed}
            tone={counts.failed > 0 ? 'destructive' : 'muted'}
          />
          <Stat label={t('rate')} value={`${ratePerSec.toFixed(1)}/s`} />
          <Stat label={t('eta')} value={formatEta(etaSeconds)} />
        </div>
      </div>
      <Progress value={percent} className="mt-3" />
      {job.error && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-xs text-destructive">
          {job.error}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string | number;
  tone?: 'muted' | 'destructive';
}): JSX.Element {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-wider">{label}</span>
      <span className={tone === 'destructive' ? 'text-destructive font-medium' : 'text-foreground'}>
        {value}
      </span>
    </span>
  );
}
