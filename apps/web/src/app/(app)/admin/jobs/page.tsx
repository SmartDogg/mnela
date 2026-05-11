'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api/client';
import {
  jobLastActivityAt,
  type JobDurationStats,
  type JobErrorRateStats,
  type JobSummary,
  type JobThroughputStats,
  type Paginated,
} from '@/lib/api/types';
import { cn, relativeTime } from '@/lib/utils';

import { errorRateTone, formatBucketTs, formatMs } from './format';

type Window = '15m' | '1h' | '6h' | '24h' | '7d';

const THROUGHPUT_WINDOWS: Window[] = ['1h', '24h'];
const REFETCH_MS = 10_000;

export default function AdminJobsPage(): JSX.Element {
  const t = useTranslations('admin.jobs');
  const queryClient = useQueryClient();
  const [throughputWindow, setThroughputWindow] = useState<Window>('1h');

  const throughput = useQuery({
    queryKey: ['admin-jobs', 'throughput', throughputWindow],
    queryFn: () =>
      api.get<JobThroughputStats>('/jobs/stats/throughput', {
        // Hour-bucket past 1h reads as flat noise — minute is fine for both windows.
        query: { bucket: 'minute', since: throughputWindow },
      }),
    refetchInterval: REFETCH_MS,
  });

  const durations = useQuery({
    queryKey: ['admin-jobs', 'durations'],
    queryFn: () => api.get<JobDurationStats>('/jobs/stats/durations', { query: { since: '24h' } }),
    refetchInterval: REFETCH_MS,
  });

  const errorRate = useQuery({
    queryKey: ['admin-jobs', 'error-rate'],
    queryFn: () =>
      api.get<JobErrorRateStats>('/jobs/stats/error-rate', { query: { since: '24h' } }),
    refetchInterval: REFETCH_MS,
  });

  const failed = useQuery({
    queryKey: ['admin-jobs', 'failed'],
    queryFn: () =>
      api.get<Paginated<JobSummary>>('/jobs', { query: { status: 'failed', limit: 20 } }),
    refetchInterval: REFETCH_MS,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post<JobSummary>(`/jobs/${encodeURIComponent(id)}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-jobs', 'failed'] });
      queryClient.invalidateQueries({ queryKey: ['admin-jobs', 'error-rate'] });
      toast.success(t('retrySuccess'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('retryFailed')),
  });

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-4 px-8 py-6">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
          <ThroughputTile
            data={throughput.data}
            isLoading={throughput.isLoading}
            window={throughputWindow}
            onWindowChange={setThroughputWindow}
          />
          <DurationTile data={durations.data} isLoading={durations.isLoading} />
          <ErrorRateTile data={errorRate.data} isLoading={errorRate.isLoading} />
        </div>

        <FailedJobsTile
          jobs={failed.data?.items ?? []}
          isLoading={failed.isLoading}
          onRetry={(id) => retry.mutate(id)}
          retryingId={retry.isPending ? retry.variables : null}
        />
      </div>
    </div>
  );
}

interface TileShellProps {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

function TileShell({
  title,
  subtitle,
  trailing,
  children,
  className,
}: TileShellProps): JSX.Element {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-card px-4 py-3 text-card-foreground',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground/80">{subtitle}</p>}
        </div>
        {trailing}
      </header>
      {children}
    </section>
  );
}

interface ThroughputTileProps {
  data: JobThroughputStats | undefined;
  isLoading: boolean;
  window: Window;
  onWindowChange: (w: Window) => void;
}

function ThroughputTile({
  data,
  isLoading,
  window,
  onWindowChange,
}: ThroughputTileProps): JSX.Element {
  const t = useTranslations('admin.jobs');
  const tw = useTranslations('admin.jobs.window');
  const points = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      ts: new Date(b.ts).getTime(),
      label: formatBucketTs(b.ts),
      count: b.count,
    }));
  }, [data]);

  return (
    <TileShell
      title={t('throughput')}
      subtitle={t('throughputSubtitle')}
      trailing={
        <Tabs value={window} onValueChange={(v) => onWindowChange(v as Window)}>
          <TabsList className="h-7">
            {THROUGHPUT_WINDOWS.map((w) => (
              <TabsTrigger key={w} value={w} className="h-5 px-2 py-0 text-[11px]">
                {tw(w)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className="h-44 w-full">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t('noBuckets')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(217 91% 60%)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </TileShell>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]!;
  const label = (point.payload as { label: string }).label;
  return (
    <div className="rounded-md border bg-popover px-2 py-1 text-popover-foreground shadow-sm">
      <p className="font-mono text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono text-xs tabular-nums">{point.value}</p>
    </div>
  );
}

function DurationTile({
  data,
  isLoading,
}: {
  data: JobDurationStats | undefined;
  isLoading: boolean;
}): JSX.Element {
  const t = useTranslations('admin.jobs');
  return (
    <TileShell title={t('duration')} subtitle={t('durationSubtitle')}>
      {isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl tabular-nums">{formatMs(data.avgMs)}</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {t('avg')}
            </span>
          </div>
          <div className="flex gap-3 border-t pt-2 text-xs text-muted-foreground">
            <DurationField label={t('p50')} value={formatMs(data.p50Ms)} />
            <DurationField label={t('p95')} value={formatMs(data.p95Ms)} />
            <DurationField label="n" value={data.total.toLocaleString()} />
          </div>
        </div>
      )}
    </TileShell>
  );
}

function DurationField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/80">{label}</span>
      <span className="font-mono text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ErrorRateTile({
  data,
  isLoading,
}: {
  data: JobErrorRateStats | undefined;
  isLoading: boolean;
}): JSX.Element {
  const t = useTranslations('admin.jobs');
  // Color thresholds: green <1%, yellow 1–5%, red >5%.
  const toneClass = !data
    ? 'text-foreground'
    : errorRateTone(data.rate) === 'ok'
      ? 'text-emerald-400'
      : errorRateTone(data.rate) === 'warn'
        ? 'text-amber-400'
        : 'text-red-400';
  return (
    <TileShell title={t('errorRate')} subtitle={t('errorRateSubtitle')}>
      {isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className={cn('font-mono text-3xl tabular-nums', toneClass)}>
              {(data.rate * 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex gap-3 border-t pt-2 text-xs text-muted-foreground">
            <DurationField
              label={t('totalCompleted')}
              value={data.totalCompleted.toLocaleString()}
            />
            <DurationField label={t('totalFailed')} value={data.totalFailed.toLocaleString()} />
          </div>
        </div>
      )}
    </TileShell>
  );
}

interface FailedJobsTileProps {
  jobs: JobSummary[];
  isLoading: boolean;
  onRetry: (id: string) => void;
  retryingId: string | null;
}

function FailedJobsTile({
  jobs,
  isLoading,
  onRetry,
  retryingId,
}: FailedJobsTileProps): JSX.Element {
  const t = useTranslations('admin.jobs');
  return (
    <TileShell title={t('lastFailed')} subtitle={t('lastFailedSubtitle')}>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">id</TableHead>
              <TableHead className="w-[180px]">type</TableHead>
              <TableHead>error</TableHead>
              <TableHead className="w-[120px] text-right">when</TableHead>
              <TableHead className="w-[88px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                  {t('noFailures')}
                </TableCell>
              </TableRow>
            )}
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="truncate font-mono text-[11px] text-muted-foreground">
                  {job.id}
                </TableCell>
                <TableCell className="font-mono text-[11px]">{job.type}</TableCell>
                <TableCell className="truncate text-xs text-red-400">
                  {(job.error ?? '').slice(0, 200) || '—'}
                </TableCell>
                <TableCell className="text-right text-[11px] text-muted-foreground">
                  {relativeTime(jobLastActivityAt(job))}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRetry(job.id)}
                    disabled={retryingId === job.id}
                    aria-label={t('retry')}
                  >
                    {retryingId === job.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    <span className="text-[11px]">{t('retry')}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TileShell>
  );
}
