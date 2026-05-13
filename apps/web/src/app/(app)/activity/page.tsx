'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { JobStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const SOURCE_FILTER_ALL = '__all__';

interface SourceOption {
  source: string;
  count: number;
}

import { EnrichmentSection } from '../jobs/_components/EnrichmentSection';
import { FailedJobs } from '../jobs/_components/FailedJobs';
import { OtherJobs } from '../jobs/_components/OtherJobs';
import { StatsPanel } from '../jobs/_components/StatsPanel';
import { useEnrichmentQueueState } from '../jobs/_components/useEnrichmentQueueState';

type ActivityTab = 'uploads' | 'queue';

function normaliseTab(value: string | null): ActivityTab {
  return value === 'queue' ? 'queue' : 'uploads';
}

function normaliseSource(value: string | null): string {
  return value && value.length > 0 ? value : SOURCE_FILTER_ALL;
}

export default function ActivityPage(): JSX.Element {
  const t = useTranslations('activity');
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = normaliseTab(searchParams.get('tab'));
  const source = normaliseSource(searchParams.get('source'));

  const updateParam = (key: string, value: string | null): void => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
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
        <Tabs value={tab} onValueChange={(v) => updateParam('tab', v)}>
          <TabsList>
            <TabsTrigger value="uploads">{t('tabs.uploads')}</TabsTrigger>
            <TabsTrigger value="queue">{t('tabs.queue')}</TabsTrigger>
          </TabsList>
          <TabsContent value="uploads" className="space-y-3 pt-4">
            <UploadsTable
              source={source}
              onSourceChange={(v) => updateParam('source', v === SOURCE_FILTER_ALL ? null : v)}
            />
          </TabsContent>
          <TabsContent value="queue" className="space-y-3 pt-4">
            <QueueTabContent />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function UploadsTable({
  source,
  onSourceChange,
}: {
  source: string;
  onSourceChange: (value: string) => void;
}): JSX.Element {
  const t = useTranslations('imports');
  const tSrc = useTranslations('imports.sources');

  const sourcesQuery = useQuery({
    queryKey: ['imports', 'sources'],
    queryFn: () => api.get<SourceOption[]>('/imports/sources'),
    refetchInterval: 10_000,
  });

  // If the user landed on /activity?source=telegram but no telegram
  // jobs exist (yet), keep showing the option so the URL stays sticky;
  // otherwise drive options purely from what the DB has.
  const dbSources = sourcesQuery.data ?? [];
  const dbHasCurrent = dbSources.some((s) => s.source === source);
  const renderOptions: SourceOption[] =
    source !== SOURCE_FILTER_ALL && !dbHasCurrent
      ? [...dbSources, { source, count: 0 }]
      : dbSources;

  const query = useQuery({
    queryKey: ['imports', source],
    queryFn: () => {
      const q: Record<string, string | number> = { page: 1, limit: 50 };
      if (source !== SOURCE_FILTER_ALL) q.source = source;
      return api.get<Paginated<JobSummary>>('/imports', { query: q });
    },
    refetchInterval: 4000,
  });

  const labelFor = (key: string): string => {
    try {
      return tSrc(key);
    } catch {
      return key;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('filterSource')}
        </span>
        <Select value={source} onValueChange={onSourceChange}>
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SOURCE_FILTER_ALL}>{t('filterAllSources')}</SelectItem>
            {renderOptions.map((opt) => (
              <SelectItem key={opt.source} value={opt.source}>
                {labelFor(opt.source)}
                {opt.count > 0 && <span className="ml-2 text-muted-foreground">({opt.count})</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">{t('columns.filename')}</TableHead>
              <TableHead>{t('columns.source')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.progress')}</TableHead>
              <TableHead className="text-right">{t('columns.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {source === SOURCE_FILTER_ALL ? t('empty') : t('emptyFiltered')}
                </TableCell>
              </TableRow>
            )}
            {query.data?.items.map((job) => {
              const filename =
                typeof job.payload?.filename === 'string'
                  ? (job.payload.filename as string)
                  : (job.id as string);
              const srcKey =
                typeof job.payload?.source === 'string'
                  ? (job.payload.source as string)
                  : 'manual_upload';
              const result = job.result as {
                documentIds?: unknown;
                duplicates?: unknown;
              } | null;
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
                    <SourceBadge value={srcKey} />
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
    </div>
  );
}

function SourceBadge({ value }: { value: string }): JSX.Element {
  const tSrc = useTranslations('imports.sources');
  // Try-catch: a stray legacy source (e.g. chatgpt_export from older
  // parsers) gets a raw fallback rather than crashing the i18n loader.
  let label = value;
  try {
    label = tSrc(value);
  } catch {
    label = value;
  }
  const color =
    value === 'telegram'
      ? 'border-sky-500/50 text-sky-400'
      : value === 'api_ingest'
        ? 'border-purple-500/50 text-purple-400'
        : value === 'voice_note'
          ? 'border-emerald-500/50 text-emerald-400'
          : 'border-muted-foreground/40 text-muted-foreground';
  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wide ${color}`}>
      {label}
    </Badge>
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
