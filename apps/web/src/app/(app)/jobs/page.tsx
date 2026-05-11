'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
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

export default function JobsPage(): JSX.Element {
  const t = useTranslations('nav');
  const tj = useTranslations('admin.jobs');
  const query = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<Paginated<JobSummary>>('/jobs', { query: { page: 1, limit: 50 } }),
    refetchInterval: 5000,
  });

  return (
    <div>
      <PageHeader
        title={t('jobs')}
        subtitle="Background jobs (ingestion, enrichment, indexing)."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/jobs">
              <Activity />
              {tj('viewDashboard')}
            </Link>
          </Button>
        }
      />
      <div className="px-8 py-6">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {query.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No jobs.
                  </TableCell>
                </TableRow>
              )}
              {query.data?.items.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{job.type}</span>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {job.progress}
                    {job.total ? ` / ${job.total}` : ''}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {relativeTime(job.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
