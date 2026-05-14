'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { RestoreLastResult } from '@/lib/api/types';

interface RestoreOverlayProps {
  jobId: string;
  filename: string;
  startedAt: number;
}

/**
 * Full-page overlay shown for the duration of a restore. Polls
 * `/admin/backups/restore/status` every 1.5s; while the api is in
 * maintenance mode every other endpoint returns 503 so the page
 * itself can't navigate or refetch its TanStack queries — only this
 * single polling fetch matters.
 *
 * When `last.status === 'done'`, the user's session was wiped along
 * with the DB. Auto-redirect to `/login` after a brief confirmation.
 *
 * On `failed`, show the error + a retry/dismiss CTA.
 */
export function RestoreOverlay({ jobId, filename, startedAt }: RestoreOverlayProps): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore.overlay');
  const stagesT = useTranslations('admin.system.sections.backups.restore.stages');
  const router = useRouter();
  const [last, setLast] = useState<RestoreLastResult | null>(null);
  const [now, setNow] = useState(Date.now());
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await api.get<{ last: RestoreLastResult | null }>(
          '/admin/backups/restore/status',
        );
        if (cancelled) return;
        setUnreachable(false);
        if (res.last && res.last.jobId === jobId) {
          setLast(res.last);
        }
      } catch {
        if (!cancelled) setUnreachable(true);
      }
    };
    void poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  // After 'done', wait 2 seconds then bounce to /login.
  useEffect(() => {
    if (last?.status !== 'done') return;
    const id = window.setTimeout(() => router.push('/login'), 2000);
    return () => window.clearTimeout(id);
  }, [last?.status, router]);

  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const stageKey = last?.stage ?? 'starting';
  const stageLabel = (() => {
    try {
      return stagesT(stageKey as never);
    } catch {
      return stageKey;
    }
  })();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-2xl">
        {last?.status === 'done' ? (
          <DoneBlock filename={filename} />
        ) : last?.status === 'failed' ? (
          <FailedBlock error={last.error ?? t('unknownError')} onDismiss={() => router.refresh()} />
        ) : (
          <RunningBlock
            filename={filename}
            stageLabel={stageLabel}
            elapsed={elapsed}
            unreachable={unreachable}
          />
        )}
      </div>
    </div>
  );
}

function RunningBlock({
  filename,
  stageLabel,
  elapsed,
  unreachable,
}: {
  filename: string;
  stageLabel: string;
  elapsed: number;
  unreachable: boolean;
}): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore.overlay');
  return (
    <>
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div>
          <p className="font-medium">{t('title')}</p>
          <p className="text-xs text-muted-foreground">{filename}</p>
        </div>
      </div>
      <div className="rounded-md bg-muted/30 p-3 text-sm">
        <p className="font-medium">{stageLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('elapsed', { seconds: elapsed })}</p>
      </div>
      {unreachable && <p className="text-xs text-amber-300">⚠ {t('unreachable')}</p>}
      <p className="text-xs text-muted-foreground">{t('warning')}</p>
    </>
  );
}

function DoneBlock({ filename }: { filename: string }): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore.overlay');
  return (
    <>
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        <div>
          <p className="font-medium">{t('doneTitle')}</p>
          <p className="text-xs text-muted-foreground">{filename}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
    </>
  );
}

function FailedBlock({ error, onDismiss }: { error: string; onDismiss: () => void }): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore.overlay');
  return (
    <>
      <div className="flex items-center gap-3">
        <XCircle className="h-6 w-6 text-destructive" />
        <p className="font-medium">{t('failedTitle')}</p>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
        {error}
      </pre>
      <p className="text-xs text-muted-foreground">{t('failedHint')}</p>
      <Button variant="outline" size="sm" onClick={onDismiss}>
        {t('failedDismiss')}
      </Button>
    </>
  );
}
