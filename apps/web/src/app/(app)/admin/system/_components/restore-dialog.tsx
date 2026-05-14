'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import type { RestoreValidationResult } from '@/lib/api/types';

interface RestoreDialogProps {
  filename: string;
  open: boolean;
  onClose: () => void;
  onConfirmed: (opts: { backupFirst: boolean }) => void;
}

export function RestoreDialog({
  filename,
  open,
  onClose,
  onConfirmed,
}: RestoreDialogProps): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore');
  const [typed, setTyped] = useState('');
  const [backupFirst, setBackupFirst] = useState(true);

  const validation = useQuery({
    queryKey: ['admin', 'backups', filename, 'validate'],
    queryFn: () =>
      api.post<RestoreValidationResult>(`/admin/backups/${encodeURIComponent(filename)}/validate`),
    enabled: open,
    retry: false,
  });

  const confirmed = typed.trim().toLowerCase() === 'restore' && validation.data?.valid === true;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description', { filename })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <ValidationBanner
            result={validation.data}
            loading={validation.isLoading}
            error={validation.error}
          />

          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">{t('warningTitle')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              <li>{t('warningDb')}</li>
              <li>{t('warningData')}</li>
              <li>{t('warningSession')}</li>
              <li>{t('warningDuration')}</li>
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="backup-first"
              checked={backupFirst}
              onCheckedChange={(c) => setBackupFirst(c === true)}
            />
            <Label htmlFor="backup-first" className="text-sm font-normal">
              {t('backupFirstLabel')}
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-input" className="text-xs text-muted-foreground">
              {t('typeConfirmLabel')}
            </Label>
            <Input
              id="confirm-input"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="restore"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!confirmed}
            onClick={() => {
              onConfirmed({ backupFirst });
              setTyped('');
            }}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidationBanner({
  result,
  loading,
  error,
}: {
  result: RestoreValidationResult | undefined;
  loading: boolean;
  error: unknown;
}): JSX.Element {
  const t = useTranslations('admin.system.sections.backups.restore');
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('validating')}
      </div>
    );
  }
  if (error) {
    const msg = error instanceof ApiError ? error.message : String(error);
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span>
          {t('validationFailed')}: {msg}
        </span>
      </div>
    );
  }
  if (!result) return <></>;
  if (!result.valid) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {t('bundleInvalid')}
        </p>
        {result.error && <p className="mt-1 text-xs text-muted-foreground">{result.error}</p>}
      </div>
    );
  }
  if (result.keystoreMatches === false) {
    return (
      <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          {t('keystoreMismatch')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('keystoreMismatchHint')}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        {t('bundleValid')}
        {result.keystoreMatches === 'no-rows' && (
          <span className="ml-1 text-xs text-muted-foreground">({t('keystoreNoRows')})</span>
        )}
      </p>
      {result.manifest && (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {t('manifestSummary', {
            createdAt: new Date(result.manifest.created_at_utc).toLocaleString(),
            source: result.manifest.source ?? 'cli',
          })}
        </p>
      )}
    </div>
  );
}
