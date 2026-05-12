'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api/client';
import { jobLastActivityAt, type JobSummary, type Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

const REFRESH_MS = 10_000;

/**
 * Collapsible list of last failed jobs with one-click retry. Folded by
 * default so a healthy queue doesn't shout red counters at you — opens
 * automatically the first time the count goes non-zero.
 */
export function FailedJobs(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState<boolean | null>(null);

  const failed = useQuery({
    queryKey: ['jobs', 'failed'],
    queryFn: () =>
      api.get<Paginated<JobSummary>>('/jobs', { query: { status: 'failed', limit: 20 } }),
    refetchInterval: REFRESH_MS,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post<JobSummary>(`/jobs/${encodeURIComponent(id)}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', 'failed'] });
      qc.invalidateQueries({ queryKey: ['jobs', 'queue-state'] });
      toast.success('Retry queued');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Retry failed'),
  });

  const count = failed.data?.items.length ?? 0;
  // Auto-open the first time we see failures so they don't hide silently.
  const effectiveOpen = open === null ? count > 0 : open;

  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen(!effectiveOpen)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          {effectiveOpen ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={`text-[11px] font-semibold uppercase tracking-widest ${count > 0 ? 'text-red-400' : 'text-muted-foreground'}`}
          >
            Failed ({count})
          </span>
        </span>
        {failed.isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </button>

      {effectiveOpen && (
        <div className="mt-2 space-y-1">
          {failed.isLoading && <Skeleton className="h-12 w-full" />}
          {!failed.isLoading && count === 0 && (
            <p className="text-[11px] text-muted-foreground">No recent failures.</p>
          )}
          {failed.data?.items.map((job) => (
            <div
              key={job.id}
              className="flex items-start gap-2 rounded border border-border/50 bg-background/40 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px]">{job.type}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTime(jobLastActivityAt(job))}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-red-300">
                  {job.error ?? '(no error message)'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => retry.mutate(job.id)}
                disabled={retry.isPending && retry.variables === job.id}
                className="h-7 px-2"
              >
                {retry.isPending && retry.variables === job.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                <span className="text-[11px]">Retry</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
