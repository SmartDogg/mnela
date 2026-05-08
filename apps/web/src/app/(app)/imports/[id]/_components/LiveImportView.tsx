'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import type { JobSummary } from '@/lib/api/types';
import { useLiveEvents } from '@/lib/socket/useLiveEvents';
import type { LiveImportDocument } from '@/lib/socket/types';
import { formatDate } from '@/lib/utils';

import { ActionBar } from './ActionBar';
import { FileList } from './FileList';
import { LiveGraphPane } from './LiveGraphPane';
import { LogTail } from './LogTail';
import { ProgressHeader, type ProgressCounts } from './ProgressHeader';
import { computeEta } from './eta';

interface LiveImportViewProps {
  id: string;
}

const FALLBACK_POLL_MS = 2_000;
const FALLBACK_BANNER_DELAY_MS = 5_000;

export function LiveImportView({ id }: LiveImportViewProps): JSX.Element {
  const t = useTranslations('imports.detail');
  const tCommon = useTranslations('common');

  const live = useLiveEvents({ jobId: id });

  // Polling cadence is gated on the live socket: when connected, the cacheSync
  // patch from ADR-0023 keeps the query fresh and we don't need to refetch.
  // When unavailable, we fall back to 2 s polling per TZ §7.2.
  const refetchInterval = live.status === 'unavailable' ? FALLBACK_POLL_MS : false;

  const jobQuery = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => api.get<JobSummary>(`/jobs/${encodeURIComponent(id)}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
      return refetchInterval;
    },
  });

  // The documents endpoint is not part of the API yet (Phase 4 wire format,
  // see QUESTIONS.md #15) — we still mount the query so that socket
  // cacheSync writes have a known cache key, and we tolerate 404s silently.
  const documentsQuery = useQuery({
    queryKey: ['imports', id, 'documents'],
    queryFn: async () => {
      try {
        return await api.get<LiveImportDocument[]>(`/imports/${encodeURIComponent(id)}/documents`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
    refetchInterval: false,
  });

  const documents = documentsQuery.data ?? [];

  const showFallbackBanner = useFallbackBanner(live.status);

  const counts = useMemo<ProgressCounts>(() => {
    const failed = documents.filter((d) => d.status === 'failed').length;
    const skipped = documents.filter((d) => d.status === 'archived').length;
    return {
      processed: jobQuery.data?.progress ?? 0,
      total: jobQuery.data?.total ?? null,
      failed,
      skipped,
    };
  }, [documents, jobQuery.data?.progress, jobQuery.data?.total]);

  // Tick once a second so ETA reflects elapsed time without waiting for
  // the next event.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (
      jobQuery.data?.status !== 'running' &&
      jobQuery.data?.status !== 'queued' &&
      jobQuery.data?.status !== 'paused'
    ) {
      return;
    }
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [jobQuery.data?.status]);

  const startedAtMs = jobQuery.data?.startedAt ? new Date(jobQuery.data.startedAt).getTime() : null;
  const eta = computeEta(counts.processed, counts.total, startedAtMs, nowMs);

  if (jobQuery.isLoading) {
    return <LoadingSkeleton />;
  }

  if (jobQuery.error instanceof ApiError && jobQuery.error.status === 404) {
    return <div className="px-8 py-10 text-sm text-muted-foreground">{tCommon('error')}</div>;
  }

  const job = jobQuery.data;
  if (!job) return <div className="px-8 py-10" />;

  const filename =
    typeof job.payload['filename'] === 'string' ? (job.payload['filename'] as string) : job.id;

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <PageHeader
        title={filename}
        subtitle={`${formatDate(job.createdAt)} · ${job.id.slice(0, 8)}…`}
        actions={<ActionBar job={job} />}
      />
      {showFallbackBanner && (
        <div
          className="border-b border-amber-500/40 bg-amber-500/10 px-8 py-2 text-xs text-amber-200"
          role="status"
          data-testid="fallback-banner"
        >
          {t('fallbackBanner')}
        </div>
      )}
      <ProgressHeader
        job={job}
        counts={counts}
        etaSeconds={eta.etaSeconds}
        ratePerSec={eta.ratePerSec}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b px-4 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('files')} · {documents.length}
            </span>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
            <FileList documents={documents} />
          </div>
        </div>
        <div className="min-h-[320px] lg:min-h-0">
          <LiveGraphPane jobId={id} />
        </div>
      </div>
      <div className="h-56 shrink-0">
        <LogTail events={live.events} />
      </div>
    </div>
  );
}

function useFallbackBanner(status: ReturnType<typeof useLiveEvents>['status']): boolean {
  const [show, setShow] = useState(false);
  // Track when we first attempted a connection so we don't flash the banner
  // on the brief idle/connecting → connected transition.
  const attemptedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'connecting' || status === 'connected') {
      attemptedAtRef.current ??= Date.now();
      if (status === 'connected') setShow(false);
      return;
    }
    if (status === 'unavailable') {
      attemptedAtRef.current ??= Date.now();
      const elapsed = Date.now() - (attemptedAtRef.current ?? Date.now());
      if (elapsed >= FALLBACK_BANNER_DELAY_MS) {
        setShow(true);
        return;
      }
      const remaining = FALLBACK_BANNER_DELAY_MS - elapsed;
      const t = window.setTimeout(() => setShow(true), remaining);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  return show;
}

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 px-8 py-6">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-2 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
