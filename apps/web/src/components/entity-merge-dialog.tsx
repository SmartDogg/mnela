'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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
import type { EntitySummary, MergeEntitiesResult, Paginated } from '@/lib/api/types';

interface EntityMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: EntitySummary;
  initialTargetId?: string;
}

export function EntityMergeDialog({
  open,
  onOpenChange,
  source,
  initialTargetId,
}: EntityMergeDialogProps): JSX.Element {
  const t = useTranslations('entityMerge');
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [targetId, setTargetId] = useState<string | undefined>(initialTargetId);
  const [preview, setPreview] = useState<MergeEntitiesResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setDebouncedSearch('');
    setTargetId(initialTargetId);
    setPreview(null);
  }, [open, initialTargetId]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const candidates = useQuery({
    queryKey: ['entities', 'search', source.type, debouncedSearch],
    queryFn: () =>
      api.get<Paginated<EntitySummary>>('/graph/entities', {
        query: { type: source.type, q: debouncedSearch || undefined, limit: 20 },
      }),
    enabled: open,
    staleTime: 10_000,
  });

  const target = candidates.data?.data.find((e) => e.id === targetId);

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<MergeEntitiesResult>('/graph/entities/merge', {
        sourceId: source.id,
        targetId,
        dryRun: true,
      }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('error.generic')),
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      api.post<MergeEntitiesResult>('/graph/entities/merge', {
        sourceId: source.id,
        targetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(
        t('success', { sourceName: source.name, targetName: target?.name ?? targetId ?? '' }),
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('error.generic')),
  });

  const filteredCandidates = (candidates.data?.data ?? []).filter(
    (e) => e.id !== source.id && e.mergedIntoId === null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('sourceLabel')}
            </Label>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-sm font-medium">{source.name}</p>
              <p className="text-[11px] text-muted-foreground">{source.type}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('targetLabel')}
            </Label>
            {target ? (
              <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                <p className="text-sm font-medium">{target.name}</p>
                <p className="text-[11px] text-muted-foreground">{target.type}</p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                {t('searchTarget')}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchTarget')}
            autoFocus
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-border/40">
            {candidates.isLoading && (
              <div className="flex items-center justify-center px-4 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
              </div>
            )}
            {!candidates.isLoading && filteredCandidates.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                {t('searchEmpty')}
              </div>
            )}
            {filteredCandidates.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setTargetId(e.id);
                  setPreview(null);
                }}
                className={
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40 ' +
                  (e.id === targetId ? 'bg-muted/60' : '')
                }
              >
                <span className="font-medium">{e.name}</span>
                <span className="text-[10px] text-muted-foreground">{e.type}</span>
              </button>
            ))}
          </div>
        </div>

        {preview && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium">{t('preview.title')}</p>
              <span className="text-[10px] text-muted-foreground">{t('preview.ready')}</span>
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <PreviewRow label={t('preview.documentLinks')} value={preview.counts.documentLinks} />
              <PreviewRow label={t('preview.edgeRepoints')} value={preview.counts.edgeRepoints} />
              <PreviewRow label={t('preview.edgeDedupes')} value={preview.counts.edgeDedupes} />
              <PreviewRow label={t('preview.selfLoops')} value={preview.counts.selfLoops} />
            </dl>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={!targetId || previewMutation.isPending || commitMutation.isPending}
          >
            {previewMutation.isPending && <Loader2 className="size-3 animate-spin" />}
            <span className={previewMutation.isPending ? 'ml-1.5' : ''}>{t('preview.run')}</span>
          </Button>
          <Button
            onClick={() => commitMutation.mutate()}
            disabled={!targetId || !preview || commitMutation.isPending}
          >
            {commitMutation.isPending && <Loader2 className="size-3 animate-spin" />}
            <span className={commitMutation.isPending ? 'ml-1.5' : ''}>{t('confirm')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono font-medium">{value}</dd>
    </>
  );
}
