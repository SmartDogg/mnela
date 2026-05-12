'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import type { JobDurationStats, JobErrorRateStats, JobThroughputStats } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { errorRateTone, formatMs } from './format';

const REFRESH_MS = 30_000;

/**
 * Collapsible "stats" — closed by default. Folds in the throughput /
 * duration / error-rate stats that used to live on the deleted /admin/jobs
 * page. They aren't needed minute-to-minute for a single-user system but
 * stay one click away when debugging.
 */
export function StatsPanel(): JSX.Element {
  const [open, setOpen] = useState(false);

  const throughput = useQuery({
    queryKey: ['jobs', 'stats', 'throughput'],
    queryFn: () =>
      api.get<JobThroughputStats>('/jobs/stats/throughput', {
        query: { bucket: 'minute', since: '24h' },
      }),
    refetchInterval: REFRESH_MS,
    enabled: open,
  });
  const durations = useQuery({
    queryKey: ['jobs', 'stats', 'durations'],
    queryFn: () => api.get<JobDurationStats>('/jobs/stats/durations', { query: { since: '24h' } }),
    refetchInterval: REFRESH_MS,
    enabled: open,
  });
  const errorRate = useQuery({
    queryKey: ['jobs', 'stats', 'error-rate'],
    queryFn: () =>
      api.get<JobErrorRateStats>('/jobs/stats/error-rate', { query: { since: '24h' } }),
    refetchInterval: REFRESH_MS,
    enabled: open,
  });

  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Stats (last 24h)
        </span>
      </button>

      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Tile title="Throughput">
            {throughput.isLoading || !throughput.data ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <p className="font-mono text-2xl tabular-nums">
                {throughput.data.buckets.reduce((acc, b) => acc + b.count, 0)}{' '}
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  jobs/24h
                </span>
              </p>
            )}
          </Tile>
          <Tile title="Duration">
            {durations.isLoading || !durations.data ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-2xl tabular-nums">{formatMs(durations.data.avgMs)}</p>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  <span>p50 {formatMs(durations.data.p50Ms)}</span>
                  <span>p95 {formatMs(durations.data.p95Ms)}</span>
                  <span>n {durations.data.total.toLocaleString()}</span>
                </div>
              </div>
            )}
          </Tile>
          <Tile title="Error rate">
            {errorRate.isLoading || !errorRate.data ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex flex-col gap-1">
                <p
                  className={cn(
                    'font-mono text-2xl tabular-nums',
                    errorRateTone(errorRate.data.rate) === 'ok'
                      ? 'text-emerald-400'
                      : errorRateTone(errorRate.data.rate) === 'warn'
                        ? 'text-amber-400'
                        : 'text-red-400',
                  )}
                >
                  {(errorRate.data.rate * 100).toFixed(2)}%
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {errorRate.data.totalFailed.toLocaleString()} failed /{' '}
                  {errorRate.data.totalCompleted.toLocaleString()} completed
                </p>
              </div>
            )}
          </Tile>
        </div>
      )}
    </section>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded border border-border/50 bg-background/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
