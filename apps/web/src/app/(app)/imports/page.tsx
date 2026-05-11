'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { JobStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api/client';
import type { JobSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

export default function ImportsPage(): JSX.Element {
  const t = useTranslations('imports');
  const query = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.get<Paginated<JobSummary>>('/imports', { query: { page: 1, limit: 50 } }),
    refetchInterval: 4000,
  });

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/imports/new">
              <Plus />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <div className="px-8 py-6">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">{t('columns.filename')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.progress')}</TableHead>
                <TableHead className="text-right">{t('columns.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {query.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No imports yet.
                  </TableCell>
                </TableRow>
              )}
              {query.data?.items.map((job) => {
                const filename =
                  typeof job.payload?.filename === 'string'
                    ? (job.payload.filename as string)
                    : (job.id as string);
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link href={`/imports/${job.id}`} className="font-medium hover:underline">
                        {filename}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <JobStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {job.progress}
                      {job.total ? ` / ${job.total}` : ''}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {relativeTime(job.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
