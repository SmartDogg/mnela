'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import type { LinkStatus } from '@/lib/api/types';
import { cn } from '@/lib/utils';

export interface EdgeEditorTarget {
  id: string;
  fromId: string;
  toId: string;
  relationType: string;
  confidence: number;
  status: LinkStatus;
}

interface EdgeEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edge: EdgeEditorTarget;
  fromName?: string;
  toName?: string;
}

const STATUSES: LinkStatus[] = ['auto_confirmed', 'needs_review', 'manual', 'rejected'];

export function EdgeEditorDialog({
  open,
  onOpenChange,
  edge,
  fromName,
  toName,
}: EdgeEditorDialogProps): JSX.Element {
  const t = useTranslations('edgeEditor');
  const queryClient = useQueryClient();

  const [relationType, setRelationType] = useState(edge.relationType);
  const [status, setStatus] = useState<LinkStatus>(edge.status);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setRelationType(edge.relationType);
      setStatus(edge.status);
      setConfirmingDelete(false);
    }
  }, [open, edge]);

  const update = useMutation({
    mutationFn: () =>
      api.patch<EdgeEditorTarget>(`/graph/edges/${encodeURIComponent(edge.id)}`, {
        relationType,
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('success.updated'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('error.generic')),
  });

  const remove = useMutation({
    mutationFn: () =>
      api.delete<{ id: string; deleted: true }>(`/graph/edges/${encodeURIComponent(edge.id)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('success.deleted'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('error.generic')),
  });

  const dirty = relationType !== edge.relationType || status !== edge.status;
  const isPending = update.isPending || remove.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('fields.fromEntity')}
            </p>
            <p className="text-sm font-medium">{fromName ?? edge.fromId}</p>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('fields.toEntity')}
            </p>
            <p className="text-sm font-medium">{toName ?? edge.toId}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="relationType" className="text-[11px] uppercase tracking-wide">
              {t('fields.relationType')}
            </Label>
            <Input
              id="relationType"
              value={relationType}
              onChange={(e) => setRelationType(e.target.value)}
              placeholder={t('fields.relationTypePlaceholder')}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">{t('fields.status')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    status === s
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="font-mono text-[10px]">
              {t('fields.confidence')} · {edge.confidence.toFixed(2)}
            </Badge>
          </div>
        </div>

        <DialogFooter className="!justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (confirmingDelete) remove.mutate();
              else setConfirmingDelete(true);
            }}
            disabled={isPending}
            className={cn(
              'text-destructive hover:text-destructive',
              confirmingDelete && 'bg-destructive/10',
            )}
          >
            {remove.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            <span className="ml-1.5">{confirmingDelete ? t('deleteConfirm') : t('delete')}</span>
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              cancel
            </Button>
            <Button
              onClick={() => update.mutate()}
              disabled={!dirty || isPending || !relationType.trim()}
            >
              {update.isPending && <Loader2 className="size-3 animate-spin" />}
              <span className={update.isPending ? 'ml-1.5' : ''}>{t('save')}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
