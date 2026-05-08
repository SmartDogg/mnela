'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import type { InboxSummary, Paginated } from '@/lib/api/types';
import { useLiveEvents } from '@/lib/socket/useLiveEvents';

import { InboxCard } from './inbox-card';

export default function InboxPage(): JSX.Element {
  const t = useTranslations('inbox');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['inbox'],
    queryFn: () =>
      api.get<Paginated<InboxSummary>>('/inbox', {
        query: { page: 1, limit: 50, status: 'pending' },
      }),
  });

  const live = useLiveEvents({ types: ['inbox.item_added'] });
  // Per ADR-0023: inbox.item_added → invalidateQueries.
  useEffect(() => {
    if (!live.lastEvent) return;
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  }, [live.lastEvent, queryClient]);

  const accept = useMutation({
    mutationFn: (id: string) => api.post<InboxSummary>(`/inbox/${encodeURIComponent(id)}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('accepted'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('actionFailed')),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post<InboxSummary>(`/inbox/${encodeURIComponent(id)}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(t('rejected'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('actionFailed')),
  });

  const items = query.data?.data ?? [];

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-2 px-8 py-6">
        {query.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        {!query.isLoading && items.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </div>
        )}
        {items.map((item) => {
          const pending = accept.isPending || reject.isPending;
          return (
            <InboxCard
              key={item.id}
              item={item}
              onAccept={() => accept.mutate(item.id)}
              onReject={() => reject.mutate(item.id)}
              isPending={pending}
            />
          );
        })}
      </div>
    </div>
  );
}
