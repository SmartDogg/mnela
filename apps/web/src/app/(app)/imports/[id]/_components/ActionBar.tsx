'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api/client';
import type { JobSummary } from '@/lib/api/types';

type ImportAction = 'pause' | 'start' | 'cancel';

interface ActionBarProps {
  job: JobSummary;
}

export function ActionBar({ job }: ActionBarProps): JSX.Element {
  const t = useTranslations('imports.detail');
  const queryClient = useQueryClient();

  const action = useMutation({
    mutationFn: (which: ImportAction) =>
      api.post<JobSummary>(`/imports/${encodeURIComponent(job.id)}/${which}`),
    onSuccess: (next) => {
      queryClient.setQueryData(['jobs', job.id], next);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('actionFailed'));
    },
  });

  const canPause = job.status === 'running';
  const canResume = job.status === 'paused';
  const canCancel = job.status === 'queued' || job.status === 'running' || job.status === 'paused';

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => action.mutate('pause')}
        disabled={!canPause || action.isPending}
        data-testid="action-pause"
      >
        <Pause /> {t('pause')}
      </Button>
      <Button
        size="sm"
        onClick={() => action.mutate('start')}
        disabled={!canResume || action.isPending}
        data-testid="action-resume"
      >
        <Play /> {t('resume')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => action.mutate('cancel')}
        disabled={!canCancel || action.isPending}
        data-testid="action-cancel"
      >
        <X /> {t('cancel')}
      </Button>
    </div>
  );
}
