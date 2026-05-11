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

export function DecisionsList(): JSX.Element {
  const t = useTranslations('decisions');
  const queryClient = useQueryClient();
  const [page] = useState(1);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [contextMd, setContextMd] = useState('');
  const [decisionMd, setDecisionMd] = useState('');
  const [consequencesMd, setConsequencesMd] = useState('');

  const query = useQuery({
    queryKey: ['decisions', page],
    queryFn: () =>
      api.get<Paginated<DecisionSummary>>('/decisions', { query: { page, limit: 50 } }),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: (body: {
      title: string;
      contextMd: string;
      decisionMd: string;
      consequencesMd: string;
    }) => api.post<DecisionSummary>('/decisions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
      setOpen(false);
      setTitle('');
      setContextMd('');
      setDecisionMd('');
      setConsequencesMd('');
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
                  value={contextMd}
                  onChange={(e) => setContextMd(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-decision">{t('fields.decision')}</Label>
                <Textarea
                  id="d-decision"
                  rows={3}
                  value={decisionMd}
                  onChange={(e) => setDecisionMd(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-cons">{t('fields.consequences')}</Label>
                <Textarea
                  id="d-cons"
                  rows={3}
                  value={consequencesMd}
                  onChange={(e) => setConsequencesMd(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!title || !decisionMd || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({ title, contextMd, decisionMd, consequencesMd })
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
                  <Badge variant="outline">{t(`status.${d.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.projectSlug ?? '—'}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {relativeTime(d.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
