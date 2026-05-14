'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Database, Download, Loader2, Play, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollapsibleSection } from '@/lib/hooks/use-collapsible-section';
import { ApiError, api } from '@/lib/api/client';
import type { BackupListResponse, BackupSummary } from '@/lib/api/types';
import { useLiveEvents } from '@/lib/socket/useLiveEvents';
import { formatBytes } from '@/lib/utils';

const BACKUP_EVENT_TYPES = [
  'backup.started',
  'backup.progress',
  'backup.done',
  'backup.failed',
] as const;

interface ActiveRun {
  jobId: string;
  stage: string;
  startedAt: number;
}

export function BackupsSection(): JSX.Element {
  const t = useTranslations('admin.system.sections.backups');
  const queryClient = useQueryClient();
  const [open, toggle] = useCollapsibleSection('backups');

  const listQuery = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api.get<BackupListResponse>('/admin/backups'),
    refetchOnWindowFocus: true,
  });

  // Live progress: pick up backup.* events. We track the latest jobId
  // locally to keep the UI consistent even if /admin/backups list lags.
  const { events } = useLiveEvents({ types: [...BACKUP_EVENT_TYPES] });
  const [active, setActive] = useState<ActiveRun | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    const e = last.event;
    switch (e.type) {
      case 'backup.started':
        setActive({ jobId: e.payload.jobId, stage: 'starting', startedAt: Date.now() });
        break;
      case 'backup.progress':
        setActive((prev) =>
          prev && prev.jobId === e.payload.jobId ? { ...prev, stage: e.payload.stage } : prev,
        );
        break;
      case 'backup.done':
        setActive(null);
        toast.success(
          t('runDoneToast', {
            filename: e.payload.filename,
            size: formatBytes(e.payload.sizeBytes),
          }),
        );
        queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
        queryClient.invalidateQueries({ queryKey: ['system', 'stats'] });
        break;
      case 'backup.failed':
        setActive(null);
        toast.error(t('runFailedToast', { error: e.payload.error }));
        queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
        break;
    }
  }, [events, queryClient, t]);

  // Seed active state from server on first load + reconnect (in case a backup
  // was already running when this client connected).
  useEffect(() => {
    const status = listQuery.data?.status;
    if (status?.running && status.jobId && !active) {
      setActive({
        jobId: status.jobId,
        stage: status.stage ?? 'running',
        startedAt: status.startedAt ? Date.parse(status.startedAt) : Date.now(),
      });
    }
    if (!status?.running && active) {
      // Server says we're idle but we still have an active run locally — sync.
      setActive(null);
    }
  }, [listQuery.data?.status, active]);

  const run = useMutation({
    mutationFn: () => api.post<{ jobId: string }>('/admin/backups/run'),
    onSuccess: (res) => {
      setActive({ jobId: res.jobId, stage: 'starting', startedAt: Date.now() });
      toast.info(t('runStartedToast'));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.warning(t('runConflictToast'));
        return;
      }
      toast.error(err instanceof ApiError ? err.message : t('runFailedGenericToast'));
    },
  });

  const deleteOne = useMutation({
    mutationFn: (filename: string) =>
      api.delete<void>(`/admin/backups/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
      toast.success(t('deleteOk'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('deleteFailed')),
  });

  const backups = listQuery.data?.backups ?? [];
  const totalSize = useMemo(() => backups.reduce((s, b) => s + b.sizeBytes, 0), [backups]);

  const isRunning = active !== null || run.isPending;

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
        >
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-muted-foreground" />
              {t('title')}
              <Badge variant="outline" className="text-[10px]">
                {backups.length}
              </Badge>
              {totalSize > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {formatBytes(totalSize)}
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">{t('subtitle')}</CardDescription>
          </div>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{t('runDescription')}</div>
            <Button onClick={() => run.mutate()} disabled={isRunning} size="sm" className="gap-1.5">
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {t('runButton')}
            </Button>
          </div>

          {active && (
            <ActiveRunBanner
              stage={active.stage}
              startedAt={active.startedAt}
              labelForStage={(s) => t(`stages.${s}` as never, { fallback: s }) as string}
              elapsedLabel={(seconds) => t('elapsed', { seconds })}
            />
          )}

          {listQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : backups.length === 0 && !active ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {backups.map((bk) => (
                <BackupRow
                  key={bk.filename}
                  backup={bk}
                  onDelete={() => deleteOne.mutate(bk.filename)}
                  deleting={deleteOne.isPending}
                />
              ))}
            </ul>
          )}

          <RestoreNote />
        </CardContent>
      )}
    </Card>
  );
}

function ActiveRunBanner({
  stage,
  startedAt,
  labelForStage,
  elapsedLabel,
}: {
  stage: string;
  startedAt: number;
  labelForStage: (stage: string) => string;
  elapsedLabel: (seconds: number) => string;
}): JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));

  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
      <span className="font-medium">{labelForStage(stage)}</span>
      <span className="text-xs text-muted-foreground">· {elapsedLabel(seconds)}</span>
    </div>
  );
}

function BackupRow({
  backup,
  onDelete,
  deleting,
}: {
  backup: BackupSummary;
  onDelete: () => void;
  deleting: boolean;
}): JSX.Element {
  const t = useTranslations('admin.system.sections.backups');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const created = new Date(backup.createdAt);
  const relative = formatRelative(created);
  const absolute = created.toLocaleString();

  const includes = backup.manifest?.includes;
  const source = backup.manifest?.source;

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-xs">{backup.filename}</span>
          {source && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {source}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span title={absolute}>{relative}</span>
          <span>· {formatBytes(backup.sizeBytes)}</span>
          {includes && (
            <>
              <ContentBadge label="postgres" included={includes.postgres} />
              <ContentBadge label="data" included={includes.data_volume} />
              <ContentBadge label="claude" included={includes.claude_creds} />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a
            href={`/_api/admin/backups/${encodeURIComponent(backup.filename)}/download`}
            download={backup.filename}
          >
            <Download className="h-3.5 w-3.5" />
            {t('download')}
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('delete')}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('confirmDeleteDescription', { filename: backup.filename })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
            >
              {t('confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function ContentBadge({ label, included }: { label: string; included: boolean }): JSX.Element {
  return (
    <span
      className={
        included
          ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300'
          : 'rounded bg-muted px-1.5 py-0.5 text-muted-foreground line-through'
      }
    >
      {label}
    </span>
  );
}

function RestoreNote(): JSX.Element {
  const t = useTranslations('admin.system.sections.backups');
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{t('restoreNoteTitle')}</p>
      <p className="mt-1">{t('restoreNoteBody')}</p>
      <pre className="mt-2 rounded bg-background p-2 font-mono">
        mnela restore &lt;file.tar.gz&gt;
      </pre>
    </div>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(diffSec) < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(-diffH, 'hour');
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 30) return rtf.format(-diffD, 'day');
  const diffMo = Math.round(diffD / 30);
  return rtf.format(-diffMo, 'month');
}
