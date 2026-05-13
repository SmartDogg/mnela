'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api/client';
import type { JobSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

import { EnrichmentSection } from '../jobs/_components/EnrichmentSection';
import { FailedJobs } from '../jobs/_components/FailedJobs';
import { OtherJobs } from '../jobs/_components/OtherJobs';
import { StatsPanel } from '../jobs/_components/StatsPanel';
import { useEnrichmentQueueState } from '../jobs/_components/useEnrichmentQueueState';

type ActivityTab = 'uploads' | 'queue';

function normaliseTab(value: string | null): ActivityTab {
  return value === 'queue' ? 'queue' : 'uploads';
}

export default function ActivityPage(): JSX.Element {
  const t = useTranslations('activity');
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = normaliseTab(searchParams.get('tab'));

  const handleTabChange = (value: string): void => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`/activity?${params.toString()}`);
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          tab === 'uploads' ? (
            <Button asChild>
              <Link href="/imports/new">
                <Plus />
                {t('newImport')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="px-8 py-6">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="uploads">{t('tabs.uploads')}</TabsTrigger>
            <TabsTrigger value="queue">{t('tabs.queue')}</TabsTrigger>
          </TabsList>
          <TabsContent value="uploads" className="space-y-3 pt-4">
            <UploadsTable />
          </TabsContent>
          <TabsContent value="queue" className="space-y-3 pt-4">
            <QueueTabContent />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function UploadsTable(): JSX.Element {
  const t = useTranslations('imports');
  const query = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.get<Paginated<JobSummary>>('/imports', { query: { page: 1, limit: 50 } }),
    refetchInterval: 4000,
  });

  return (
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
            const result = job.result as { documentIds?: unknown; duplicates?: unknown } | null;
            const docIds = Array.isArray(result?.documentIds)
              ? (result?.documentIds.length as number)
              : null;
            const duplicates =
              typeof result?.duplicates === 'number' ? (result.duplicates as number) : 0;
            const progress =
              docIds === null
                ? '—'
                : duplicates > 0
                  ? `${docIds} (${duplicates} dup)`
                  : String(docIds);
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
                  {progress}
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
  );
}

function QueueTabContent(): JSX.Element {
  const queue = useEnrichmentQueueState();
  return (
    <>
      <EnrichmentSection state={queue.data} isLoading={queue.isLoading} />
      <OtherJobs />
      <FailedJobs />
      <StatsPanel />
    </>
  );
}
