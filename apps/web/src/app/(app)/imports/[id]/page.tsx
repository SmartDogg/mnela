'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, RefreshCcw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { JobStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ApiError, api } from '@/lib/api/client';
import type { JobSummary } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';

const POLL_MS = 2000;

export default function ImportDetailPage(): JSX.Element {
  const t = useTranslations('imports.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['import', id],
    queryFn: () => api.get<JobSummary>(`/jobs/${encodeURIComponent(id)}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
      return POLL_MS;
    },
  });

  const action = useMutation({
    mutationFn: (path: 'pause' | 'cancel' | 'start' | 'retry') => {
      const endpoint =
        path === 'retry'
          ? `/jobs/${encodeURIComponent(id)}/retry`
          : `/imports/${encodeURIComponent(id)}/${path}`;
      return api.post<JobSummary>(endpoint);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import', id] }),
  });

  if (query.isLoading) {
    return <div className="px-8 py-10 text-sm text-muted-foreground">{tCommon('loading')}</div>;
  }

  if (query.error instanceof ApiError && query.error.status === 404) {
    return <div className="px-8 py-10 text-sm text-muted-foreground">{tCommon('error')}</div>;
  }

  const job = query.data;
  if (!job) return <div className="px-8 py-10" />;

  const filename =
    typeof job.payload?.filename === 'string'
      ? (job.payload.filename as string)
      : (job.id as string);

  const percent = job.total ? Math.round((job.progress / job.total) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={filename}
        subtitle={`${formatDate(job.createdAt)} · ${job.id.slice(0, 8)}…`}
        actions={
          <>
            {job.status === 'running' && (
              <Button
                variant="outline"
                onClick={() => action.mutate('pause')}
                disabled={action.isPending}
              >
                <Pause /> {t('pause')}
              </Button>
            )}
            {job.status === 'paused' && (
              <Button onClick={() => action.mutate('start')} disabled={action.isPending}>
                <Play /> {t('resume')}
              </Button>
            )}
            {(job.status === 'queued' || job.status === 'running' || job.status === 'paused') && (
              <Button
                variant="outline"
                onClick={() => action.mutate('cancel')}
                disabled={action.isPending}
              >
                <X /> {t('cancel')}
              </Button>
            )}
            {job.status === 'failed' && (
              <Button onClick={() => action.mutate('retry')} disabled={action.isPending}>
                <RefreshCcw /> {t('retry')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 px-8 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('progress')}</CardTitle>
              <JobStatusBadge status={job.status} />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Progress value={percent} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {job.progress}
                {job.total ? ` / ${job.total}` : ''} ({percent}%)
              </p>
              {job.error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {job.error}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('graph')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-dashed bg-muted/20 p-12 text-center text-xs text-muted-foreground">
                {t('graphPlaceholder')}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('files')}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-xs scrollbar-thin">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
