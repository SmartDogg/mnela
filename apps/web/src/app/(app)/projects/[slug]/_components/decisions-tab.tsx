'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { DecisionSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

function statusLabel(t: ReturnType<typeof useTranslations>, status: string): string {
  return t.has(`status.${status}`) ? t(`status.${status}`) : status.replace(/_/g, ' ');
}

interface DecisionsTabProps {
  projectId: string;
  projectSlug: string;
}

export function DecisionsTab({ projectId, projectSlug }: DecisionsTabProps): JSX.Element {
  const t = useTranslations('decisions');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [decision, setDecision] = useState('');
  const [consequences, setConsequences] = useState('');

  const query = useQuery({
    queryKey: ['project', projectSlug, 'decisions'],
    queryFn: () =>
      api.get<Paginated<DecisionSummary>>('/decisions', {
        query: { projectSlug, page: 1, limit: 50 },
      }),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: (body: {
      title: string;
      decision: string;
      projectId: string;
      context?: string;
      consequences?: string;
    }) => api.post<DecisionSummary>('/decisions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectSlug, 'decisions'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectSlug, 'decisions-count'] });
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

  const items = query.data?.items ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
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
                      projectId,
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

        {query.isLoading && <Skeleton className="h-32 w-full" />}
        {!query.isLoading && items.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">No decisions yet.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y">
            {items.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex-1 truncate font-medium">{d.title}</span>
                <Badge variant="outline" className="text-xs">
                  {statusLabel(t, d.status)}
                </Badge>
                <span className="w-24 text-right text-xs text-muted-foreground">
                  {relativeTime(d.decidedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
