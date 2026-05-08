'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { DocumentStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api/client';
import type { DocumentDetail } from '@/lib/api/types';
import { formatBytes, formatDate } from '@/lib/utils';

export function DocumentDetailView({ document }: { document: DocumentDetail }): JSX.Element {
  const t = useTranslations('documentDetail');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(document.title);
  const [contentMd, setContentMd] = useState(document.contentMd);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<{ title: string; contentMd: string }>) =>
      api.patch<DocumentDetail>(`/documents/${encodeURIComponent(document.id)}`, body),
    onSuccess: (next) => {
      toast.success(t('saved'));
      queryClient.setQueryData(['document', document.id], next);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    },
  });

  const dirty = title !== document.title || contentMd !== document.contentMd;

  return (
    <div className="grid grid-cols-1 gap-0 xl:grid-cols-[1fr_320px]">
      <div className="border-b xl:border-b-0 xl:border-r">
        <div className="flex flex-col gap-3 border-b px-8 py-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{document.type}</span>
            <span>·</span>
            <span>{document.source}</span>
            <span>·</span>
            <DocumentStatusBadge status={document.status} />
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-none bg-transparent px-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <p className="text-xs text-muted-foreground">
            {formatDate(document.updatedAt)} · {document.language ?? 'unknown'}
          </p>
        </div>

        <Tabs defaultValue="rendered" className="px-8 py-4">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="rendered">{t('rendered')}</TabsTrigger>
              <TabsTrigger value="raw">{t('raw')}</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              disabled={!dirty || updateMutation.isPending}
              onClick={() => updateMutation.mutate({ title, contentMd })}
            >
              {updateMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {updateMutation.isPending ? t('saving') : t('save')}
            </Button>
          </div>
          <TabsContent value="rendered">
            <Textarea
              value={contentMd}
              onChange={(e) => setContentMd(e.target.value)}
              rows={20}
              spellCheck={false}
              className="font-mono text-sm"
            />
          </TabsContent>
          <TabsContent value="raw">
            <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-4 font-mono text-xs scrollbar-thin">
              {document.rawText}
            </pre>
          </TabsContent>
        </Tabs>
      </div>

      <aside className="space-y-4 px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('metadata')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label={t('status')} value={document.status} />
            <Field label={t('source')} value={document.source} />
            <Field label={t('language')} value={document.language ?? '—'} />
            <Field
              label={t('size')}
              value={document.byteSize ? formatBytes(document.byteSize) : '—'}
            />
            <Field
              label={t('hash')}
              value={
                <code className="font-mono text-xs">{document.contentHash.slice(0, 12)}…</code>
              }
            />
            <Field
              label={t('fetchedAt')}
              value={document.fetchedAt ? formatDate(document.fetchedAt) : '—'}
            />
          </CardContent>
        </Card>

        {document.projectSlugs && document.projectSlugs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {document.projectSlugs.map((slug) => (
                <Badge key={slug} variant="outline">
                  {slug}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="text-sm">{value}</div>
    </div>
  );
}
