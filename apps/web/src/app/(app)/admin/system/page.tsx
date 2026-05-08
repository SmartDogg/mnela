'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ApiError, api } from '@/lib/api/client';
import type { SystemConfigEntry, SystemStats } from '@/lib/api/types';
import { formatBytes, formatDate } from '@/lib/utils';

export default function AdminSystemPage(): JSX.Element {
  const t = useTranslations('admin.system');
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const stats = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: () => api.get<SystemStats>('/system/stats'),
  });

  const config = useQuery({
    queryKey: ['system', 'config'],
    queryFn: () => api.get<SystemConfigEntry[]>('/system/config'),
  });

  const save = useMutation({
    mutationFn: () => api.patch<SystemConfigEntry>('/system/config', { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
      setKey('');
      setValue('');
      toast.success('Updated');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed'),
  });

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="px-8 py-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {stats.isLoading && <Skeleton className="h-5 w-full" />}
            {stats.data && (
              <>
                <Field label="Documents" value={stats.data.documents} />
                <Field label="Entities" value={stats.data.entities} />
                <Field label="Edges" value={stats.data.edges} />
                <Field label="Projects" value={stats.data.projects} />
                <Field label="Decisions" value={stats.data.decisions} />
                <Field label="DB size" value={formatBytes(stats.data.dbSizeBytes)} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="cfg-key">{t('configKey')}</Label>
                <Input id="cfg-key" value={key} onChange={(e) => setKey(e.target.value)} />
              </div>
              <div className="flex-[2] space-y-1.5">
                <Label htmlFor="cfg-value">{t('configValue')}</Label>
                <Input id="cfg-value" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <Button disabled={!key || save.isPending} onClick={() => save.mutate()}>
                {t('configUpdate')}
              </Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.data?.map((entry) => (
                    <TableRow key={entry.key}>
                      <TableCell className="font-mono text-xs">{entry.key}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.value}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDate(entry.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}
