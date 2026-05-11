'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Loader2, RotateCw, Save } from 'lucide-react';
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
import { formatDate } from '@/lib/utils';

interface TranscriptionMeta {
  engine?: string;
  model?: string;
  language?: string;
  durationSec?: number;
  completedAt?: string;
}

function readTranscriptionMeta(metadata: Record<string, unknown>): TranscriptionMeta | null {
  const t = metadata['transcription'];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const obj = t as Record<string, unknown>;
  return {
    engine: typeof obj['engine'] === 'string' ? obj['engine'] : undefined,
    model: typeof obj['model'] === 'string' ? obj['model'] : undefined,
    language: typeof obj['language'] === 'string' ? obj['language'] : undefined,
    durationSec: typeof obj['durationSec'] === 'number' ? obj['durationSec'] : undefined,
    completedAt: typeof obj['completedAt'] === 'string' ? obj['completedAt'] : undefined,
  };
}

function formatDuration(sec: number | undefined): string {
  if (sec === undefined) return '—';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DocumentDetailView({ document }: { document: DocumentDetail }): JSX.Element {
  const t = useTranslations('documentDetail');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(document.title);
  // Document model has rawText + optional cleanText (enrichment output). The
  // editor edits cleanText so the user's manual corrections don't overwrite
  // the source-of-truth rawText.
  const initialContent = document.cleanText ?? document.rawText;
  const [contentMd, setContentMd] = useState(initialContent);

  const isAudio = document.type === 'audio';
  const transcription = readTranscriptionMeta(document.metadata);
  const audioSrc = isAudio ? `/_api/documents/${encodeURIComponent(document.id)}/attachment` : null;

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

  const retranscribeMutation = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string }>(`/documents/${encodeURIComponent(document.id)}/retranscribe`, {}),
    onSuccess: (res) => {
      toast.success(t('audio.retranscribeStarted', { jobId: res.jobId.slice(0, 8) }));
      queryClient.invalidateQueries({ queryKey: ['document', document.id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(t('audio.whisperUnavailable'));
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Failed to re-transcribe');
    },
  });

  const dirty = title !== document.title || contentMd !== initialContent;

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

        {isAudio && audioSrc && (
          <div className="space-y-3 border-b bg-muted/20 px-8 py-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <AudioLines className="h-3.5 w-3.5" />
              {t('audio.player')}
            </div>
            <audio controls preload="metadata" src={audioSrc} className="w-full">
              <track kind="captions" />
            </audio>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {transcription?.language && (
                <span>
                  {t('audio.language')}: <strong>{transcription.language}</strong>
                </span>
              )}
              {transcription?.durationSec !== undefined && (
                <span>
                  {t('audio.duration')}: {formatDuration(transcription.durationSec)}
                </span>
              )}
              {transcription?.model && (
                <span>
                  {t('audio.model')}: {transcription.model}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => retranscribeMutation.mutate()}
                disabled={retranscribeMutation.isPending}
              >
                {retranscribeMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCw />
                )}
                {t('audio.retranscribe')}
              </Button>
            </div>
            {document.status === 'raw' && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                {t('audio.awaitingTranscription')}
              </p>
            )}
          </div>
        )}

        <Tabs defaultValue={isAudio && document.rawText ? 'raw' : 'rendered'} className="px-8 py-4">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="rendered">{t('rendered')}</TabsTrigger>
              <TabsTrigger value="raw">{isAudio ? t('audio.transcript') : t('raw')}</TabsTrigger>
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
            {isAudio && document.rawText.length === 0 ? (
              <p className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {t('audio.transcriptEmpty')}
              </p>
            ) : (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 font-mono text-xs leading-relaxed scrollbar-thin">
                {document.rawText}
              </pre>
            )}
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
              value={
                document.rawText.length > 0
                  ? `${document.rawText.length.toLocaleString()} chars`
                  : '—'
              }
            />
            <Field
              label={t('hash')}
              value={
                <code className="font-mono text-xs">{document.contentHash.slice(0, 12)}…</code>
              }
            />
            <Field
              label={t('fetchedAt')}
              value={document.enrichedAt ? formatDate(document.enrichedAt) : '—'}
            />
          </CardContent>
        </Card>

        {(() => {
          const importMeta =
            document.metadata && typeof document.metadata === 'object'
              ? (document.metadata['__import'] as { batchId?: string; origin?: string } | undefined)
              : undefined;
          if (!importMeta?.batchId) return null;
          return (
            <Card>
              <CardHeader>
                <CardTitle>Import</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="outline">{importMeta.origin ?? 'upload'}</Badge>
                <code className="font-mono text-[10px] text-muted-foreground">
                  {importMeta.batchId.slice(0, 8)}…
                </code>
              </CardContent>
            </Card>
          );
        })()}
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
