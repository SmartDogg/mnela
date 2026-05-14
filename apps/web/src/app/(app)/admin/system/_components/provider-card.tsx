'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2, ServerCrash, TestTube2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api/client';
import type { LlmProviderRow, ProviderTestResult } from '@/lib/api/types';

export function ProviderCard({
  provider,
  onChanged,
}: {
  provider: LlmProviderRow;
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.providers');
  const [lastTest, setLastTest] = useState<ProviderTestResult | null>(null);

  const test = useMutation({
    mutationFn: () => api.post<ProviderTestResult>(`/admin/providers/${provider.id}/test`),
    onSuccess: (res) => {
      setLastTest(res);
      if (res.ok) toast.success(t('probeOk', { name: provider.name, latency: res.latencyMs }));
      else toast.error(t('probeError', { name: provider.name, error: res.error ?? 'failed' }));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('probeFailed')),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/providers/${provider.id}`),
    onSuccess: () => {
      toast.success(t('removed', { name: provider.name }));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('deleteFailed')),
  });

  const confirmDelete = (): void => {
    if (window.confirm(t('deleteConfirm', { name: provider.name }))) {
      remove.mutate();
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{provider.name}</CardTitle>
          <div className="flex items-center gap-1">
            {provider.builtin && (
              <Badge variant="outline" className="text-[10px]">
                {t('builtin')}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {t(`kinds.${provider.kind}`)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{provider.model || '—'}</span>
          {provider.baseUrl && <span className="font-mono">{provider.baseUrl}</span>}
          {/*
            Tool-use badge — set when the latest provider.test() probed a
            dummy tool definition and got no `tool_calls` back. Without
            tool use the agent loop can't issue mnela_search /
            mnela_find_similar, so the chat answer comes back without
            citation chips. Built-ins always support tools.
          */}
          {provider.extra?.toolUseDetected === false && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[9px] text-amber-600 dark:text-amber-400"
            >
              {t('noCitations')}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-xs">
        <div className="flex items-center gap-2">
          <KeyRound className="size-3" />
          {provider.builtin ? (
            <span className="text-muted-foreground">{t('noKeyRequired')}</span>
          ) : provider.hasKey ? (
            <span className="font-mono text-muted-foreground">
              sk-…{provider.apiKeyLast4 ?? '????'}
            </span>
          ) : (
            <span className="text-amber-500">{t('noKey')}</span>
          )}
        </div>

        {lastTest && (
          <div className="flex items-center gap-2 text-[11px]">
            {lastTest.ok ? (
              <CheckCircle2 className="size-3 text-emerald-500" />
            ) : (
              <ServerCrash className="size-3 text-destructive" />
            )}
            <span className={lastTest.ok ? 'text-emerald-600' : 'text-destructive'}>
              {lastTest.ok ? `ok (${lastTest.latencyMs}ms)` : (lastTest.error ?? 'failed')}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <TestTube2 className="size-3" />
            )}{' '}
            {t('test')}
          </Button>
          {!provider.builtin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              <Trash2 className="size-3" /> {t('delete')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
