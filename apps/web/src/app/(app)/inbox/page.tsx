'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import type { InboxSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

export default function InboxPage(): JSX.Element {
  const t = useTranslations('nav');
  const query = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<Paginated<InboxSummary>>('/inbox', { query: { page: 1, limit: 50 } }),
  });

  return (
    <div>
      <PageHeader
        title={t('inbox')}
        subtitle="Items waiting for review (entity merges, edge suggestions)."
      />
      <div className="px-8 py-6 space-y-3">
        {query.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        {query.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Empty. Inbox surfaces in Phase 7.</p>
        )}
        {query.data?.data.map((item) => (
          <Card key={item.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">{item.type}</CardTitle>
              <Badge variant="outline">{item.status}</Badge>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {relativeTime(item.createdAt)}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
