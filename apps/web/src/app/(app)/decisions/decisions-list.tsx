'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { DecisionSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

// Status is `String` in Prisma (default 'active') — not an enum, so any
// value can land here. Render whatever the API returns: localized when we
// have a translation, otherwise the raw value beautified. This keeps a
// stray status from the DB from blowing up the whole page (next-intl
// throws MISSING_MESSAGE on `t('status.unknown')`).
function statusLabel(t: ReturnType<typeof useTranslations>, status: string): string {
  return t.has(`status.${status}`) ? t(`status.${status}`) : status.replace(/_/g, ' ');
}

export function DecisionsList(): JSX.Element {
  const t = useTranslations('decisions');
  const queryClient = useQueryClient();
  const [page] = useState(1);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [decision, setDecision] = useState('');
  const [consequences, setConsequences] = useState('');

  const query = useQuery({
    queryKey: ['decisions', page],
    queryFn: () =>
      api.get<Paginated<DecisionSummary>>('/decisions', { query: { page, limit: 50 } }),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: (body: {
      title: string;
      decision: string;
      context?: string;
      consequences?: string;
    }) => api.post<DecisionSummary>('/decisions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
      setOpen(false);
      setTitle('');
      setContext('');
      setDecision('');
      setConsequences('');
      toast.success('Decision created');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create');
    },
  });

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex items-center justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> {t('create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('create')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="d-title">{t('fields.title')}</Label>
                <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-context">{t('fields.context')}</Label>
                <Textarea
                  id="d-context"
                  rows={3}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-decision">{t('fields.decision')}</Label>
                <Textarea
                  id="d-decision"
                  rows={3}
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-cons">{t('fields.consequences')}</Label>
                <Textarea
                  id="d-cons"
                  rows={3}
                  value={consequences}
                  onChange={(e) => setConsequences(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!title || !decision || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    title,
                    decision,
                    ...(context ? { context } : {}),
                    ...(consequences ? { consequences } : {}),
                  })
                }
              >
                {createMutation.isPending && <Loader2 className="animate-spin" />}
                {t('create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.title')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.project')}</TableHead>
              <TableHead className="text-right">{t('columns.updated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No decisions yet.
                </TableCell>
              </TableRow>
            )}
            {query.data?.items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{statusLabel(t, d.status)}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.projectId ? (
                    <code className="font-mono">{d.projectId.slice(0, 8)}…</code>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {relativeTime(d.decidedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
