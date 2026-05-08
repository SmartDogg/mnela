'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { DocumentStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { api } from '@/lib/api/client';
import type { DocumentStatus, DocumentSummary, Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

const STATUS_OPTIONS: DocumentStatus[] = [
  'raw',
  'parsed',
  'enriching',
  'enriched',
  'failed',
  'archived',
];

export function DocumentsList(): JSX.Element {
  const t = useTranslations('documents');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | DocumentStatus>('all');

  const query = useQuery({
    queryKey: ['documents', page, q, status],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>('/documents', {
        query: {
          page,
          limit: 25,
          q: q || undefined,
          status: status === 'all' ? undefined : status,
        },
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t('filters.search')}
          className="max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as 'all' | DocumentStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('filters.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50%]">{t('columns.title')}</TableHead>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.source')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.language')}</TableHead>
              <TableHead className="text-right">{t('columns.updated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {query.data?.data.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <Link href={`/documents/${doc.id}`} className="font-medium hover:underline">
                    {doc.title}
                  </Link>
                  {doc.contentPreview && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {doc.contentPreview}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{doc.type}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{doc.source}</span>
                </TableCell>
                <TableCell>
                  <DocumentStatusBadge status={doc.status} />
                </TableCell>
                <TableCell>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {doc.language ?? '—'}
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {relativeTime(doc.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {query.data && query.data.total > query.data.limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {query.data.page} of {Math.max(1, Math.ceil(query.data.total / query.data.limit))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * query.data.limit >= query.data.total || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
