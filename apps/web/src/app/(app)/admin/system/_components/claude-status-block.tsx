'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import type { ClaudeStatus, ClaudeTestResult } from '@/lib/api/types';
import { cn, relativeTime } from '@/lib/utils';

type ReasonKey = NonNullable<ClaudeStatus['reason']>;

const REASON_KEY_MAP: Record<ReasonKey, string> = {
  'no-binary': 'noBinary',
  'not-logged-in': 'notLoggedIn',
  'rate-limit': 'rateLimit',
  'orchestrator-not-running': 'orchestratorNotRunning',
};

export function ClaudeStatusBlock(): JSX.Element {
  const t = useTranslations('system.claude');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const status = useQuery({
    queryKey: ['system', 'claude-status'],
    queryFn: () => api.get<ClaudeStatus>('/system/claude-status'),
  });

  const test = useMutation({
    mutationFn: () => api.post<ClaudeTestResult>('/system/claude-test'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'claude-status'] });
    },
  });

  const data = status.data;
  const reasonKey = data?.reason ? REASON_KEY_MAP[data.reason] : undefined;

  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="text-sm font-medium">{t('title')}</span>
          {status.isLoading ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-[10px] uppercase tracking-wide',
                data?.available
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-amber-500/50 text-amber-400',
              )}
            >
              {data?.available ? t('available') : t('unavailable')}
            </Badge>
          )}
        </button>
        {open && (
          <Button
            onClick={() => test.mutate()}
            disabled={test.isPending}
            size="sm"
            variant="outline"
          >
            {test.isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" /> {t('testRunning')}
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 size-3" /> {t('test')}
              </>
            )}
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t border-border/40 px-3 py-2 text-sm">
          {reasonKey && !data?.available && (
            <p className="font-mono text-xs text-muted-foreground">{t(`reasons.${reasonKey}`)}</p>
          )}
          {data?.available && data.version && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t('version')}</span>{' '}
              <span className="font-mono">{data.version}</span>
            </p>
          )}
          {data?.checkedAt && data.checkedAt !== '1970-01-01T00:00:00.000Z' && (
            <p className="text-xs text-muted-foreground">
              {t('lastTest')}: {relativeTime(data.checkedAt)}
            </p>
          )}
          {data?.reason === 'rate-limit' && data.resetAt && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              {t('rateLimit.resumesAt', {
                time: format.dateTime(new Date(data.resetAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                  weekday: 'short',
                }),
              })}
            </p>
          )}
          {test.data && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">
                {test.data.ok ? t('testSucceeded') : t('testFailed')}
              </span>
              {test.data.version && (
                <span className="ml-2 font-mono text-muted-foreground">v{test.data.version}</span>
              )}
              <span className="ml-2 font-mono text-muted-foreground">
                · {test.data.latencyMs}ms
              </span>
              {test.data.error && (
                <p className="mt-1 font-mono text-muted-foreground">{test.data.error}</p>
              )}
            </div>
          )}
          {test.error instanceof ApiError && (
            <p className="text-xs text-red-400">{test.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
