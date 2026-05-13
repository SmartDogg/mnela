'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageCircle,
  ServerCrash,
  TestTube2,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCollapsibleSection } from '@/lib/hooks/use-collapsible-section';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import type { TelegramAllowedUserRow, TelegramConfig, TelegramTestResult } from '@/lib/api/types';

/**
 * /admin/system → Telegram card (ADR-0053).
 *
 * Three sub-blocks:
 *  1. Token + identity — secret input, "…last4" indicator, Test Connection
 *  2. Behaviour — enabled toggle, bundleWindowMs, defaultProjectSlug
 *  3. Whitelist — list of allowed Telegram user_ids with add/remove
 *
 * Every mutation hits /admin/telegram/* and the API service publishes a
 * `system.telegram_reload` event so apps/tg-bot picks up the change in
 * under a second without a restart.
 */
export function TelegramSection(): JSX.Element {
  const t = useTranslations('admin.telegram');
  const queryClient = useQueryClient();
  const [open, toggle] = useCollapsibleSection('telegram');

  const config = useQuery({
    queryKey: ['admin', 'telegram', 'config'],
    queryFn: () => api.get<TelegramConfig>('/admin/telegram/config'),
    // Don't hit the api on every page load when the card is closed.
    enabled: open,
  });
  const whitelist = useQuery({
    queryKey: ['admin', 'telegram', 'whitelist'],
    queryFn: () => api.get<TelegramAllowedUserRow[]>('/admin/telegram/whitelist'),
    enabled: open,
  });

  const refresh = (): void => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'telegram'] });
  };

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={toggle}>
        <CardTitle className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <MessageCircle className="size-4" />
          {t('title')}
          <Badge variant="outline" className="text-[10px]">
            ADR-0053
          </Badge>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6">
          {config.isLoading && <Skeleton className="h-24 w-full" />}
          {config.data && (
            <>
              <TokenBlock config={config.data} onChanged={refresh} />
              <BehaviourBlock config={config.data} onChanged={refresh} />
              <WhitelistBlock
                rows={whitelist.data ?? []}
                isLoading={whitelist.isLoading}
                onChanged={refresh}
              />
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ============================================================================
// Token + identity
// ============================================================================

function TokenBlock({
  config,
  onChanged,
}: {
  config: TelegramConfig;
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.telegram');
  const [token, setToken] = useState('');
  const [lastTest, setLastTest] = useState<TelegramTestResult | null>(null);

  const save = useMutation({
    mutationFn: (plaintext: string) =>
      api.put<TelegramConfig>('/admin/telegram/config', { token: plaintext }),
    onSuccess: () => {
      setToken('');
      toast.success(t('tokenSaved'));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('tokenSaveFailed')),
  });

  const clear = useMutation({
    mutationFn: () => api.put<TelegramConfig>('/admin/telegram/config', { token: null }),
    onSuccess: () => {
      toast.success(t('tokenCleared'));
      setLastTest(null);
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('tokenClearFailed')),
  });

  const test = useMutation({
    mutationFn: () => api.post<TelegramTestResult>('/admin/telegram/test'),
    onSuccess: (res) => {
      setLastTest(res);
      if (res.ok) toast.success(t('testOk', { username: res.botUsername ?? 'bot' }));
      else toast.error(t('testFailed', { error: res.error ?? 'failed' }));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('testFailedGeneric')),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">{t('botToken')}</Label>
        {config.hasToken && (
          <span className="font-mono text-xs text-muted-foreground">
            …{config.tokenLast4 ?? '????'}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('tokenHint')}</p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={config.hasToken ? t('rotatePlaceholder') : t('newPlaceholder')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono text-xs"
        />
        <Button
          size="sm"
          onClick={() => save.mutate(token)}
          disabled={token.length < 20 || save.isPending}
        >
          {save.isPending ? <Loader2 className="size-3 animate-spin" /> : t('saveToken')}
        </Button>
      </div>
      {config.hasToken && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {config.botUsername ? (
                <span className="font-mono">@{config.botUsername}</span>
              ) : (
                <span className="text-muted-foreground">{t('identityUnknown')}</span>
              )}
              {config.botId && (
                <Badge variant="outline" className="text-[10px]">
                  id {config.botId}
                </Badge>
              )}
            </div>
            {lastTest && (
              <div className="flex items-center gap-1">
                {lastTest.ok ? (
                  <CheckCircle2 className="size-3 text-emerald-500" />
                ) : (
                  <ServerCrash className="size-3 text-destructive" />
                )}
                <span className={lastTest.ok ? 'text-emerald-600' : 'text-destructive'}>
                  {lastTest.ok
                    ? `${lastTest.botFirstName ?? '—'} (${lastTest.latencyMs}ms)`
                    : (lastTest.error ?? 'failed')}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              {test.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <TestTube2 className="size-3" />
              )}{' '}
              {t('test')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(t('clearConfirm'))) clear.mutate();
              }}
              disabled={clear.isPending}
            >
              <Trash2 className="size-3" /> {t('clear')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Behaviour (enabled toggle, bundle window, default scope)
// ============================================================================

function BehaviourBlock({
  config,
  onChanged,
}: {
  config: TelegramConfig;
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.telegram');
  const [bundleMs, setBundleMs] = useState<string>(String(config.bundleWindowMs));
  const [scope, setScope] = useState<string>(config.defaultProjectSlug ?? '');

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.put<TelegramConfig>('/admin/telegram/config', patch),
    onSuccess: () => {
      toast.success(t('behaviourSaved'));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('behaviourSaveFailed')),
  });

  const canEnable = config.hasToken;

  return (
    <div className="space-y-3 border-t border-border/40 pt-4">
      <Label className="text-sm font-medium">{t('behaviourTitle')}</Label>

      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={config.enabled}
              disabled={!canEnable || update.isPending}
              onCheckedChange={(checked) => update.mutate({ enabled: Boolean(checked) })}
            />
            <span>{t('enabledLabel')}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {canEnable ? t('enabledHint') : t('enabledNeedsToken')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tg-bundle" className="text-xs">
            {t('bundleWindowLabel')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="tg-bundle"
              type="number"
              min={500}
              max={30000}
              value={bundleMs}
              onChange={(e) => setBundleMs(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => update.mutate({ bundleWindowMs: Number(bundleMs) })}
              disabled={!/^\d+$/.test(bundleMs) || update.isPending}
            >
              {t('save')}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('bundleWindowHint')}</p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="tg-scope" className="text-xs">
            {t('defaultScopeLabel')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="tg-scope"
              type="text"
              placeholder={t('defaultScopePlaceholder')}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() =>
                update.mutate({ defaultProjectSlug: scope.trim() === '' ? null : scope.trim() })
              }
              disabled={update.isPending}
            >
              {t('save')}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('defaultScopeHint')}</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Whitelist
// ============================================================================

function WhitelistBlock({
  rows,
  isLoading,
  onChanged,
}: {
  rows: TelegramAllowedUserRow[];
  isLoading: boolean;
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.telegram');
  const [tgUserId, setTgUserId] = useState('');
  const [label, setLabel] = useState('');

  const add = useMutation({
    mutationFn: (body: { tgUserId: string; label: string | null }) =>
      api.post<TelegramAllowedUserRow>('/admin/telegram/whitelist', body),
    onSuccess: () => {
      setTgUserId('');
      setLabel('');
      toast.success(t('whitelistAdded'));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('whitelistAddFailed')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/telegram/whitelist/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(t('whitelistRemoved'));
      onChanged();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : t('whitelistRemoveFailed')),
  });

  return (
    <div className="space-y-3 border-t border-border/40 pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t('whitelistTitle')}</Label>
        <Badge variant="outline" className="text-[10px]">
          {rows.length}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('whitelistHint')}</p>

      <div className="flex flex-wrap gap-2">
        <Input
          type="text"
          placeholder={t('whitelistUserIdPlaceholder')}
          value={tgUserId}
          onChange={(e) => setTgUserId(e.target.value)}
          className="h-8 max-w-[180px] font-mono text-xs"
        />
        <Input
          type="text"
          placeholder={t('whitelistLabelPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={() =>
            add.mutate({
              tgUserId: tgUserId.trim(),
              label: label.trim() === '' ? null : label.trim(),
            })
          }
          disabled={!/^-?\d+$/.test(tgUserId.trim()) || add.isPending}
        >
          {add.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <UserPlus className="size-3" />
          )}
          {t('whitelistAdd')}
        </Button>
      </div>

      {isLoading && <Skeleton className="h-8 w-full" />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t('whitelistEmpty')}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border/40 rounded border border-border/60">
          {rows.map((r) => (
            <li
              key={r.tgUserId}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <div className="space-y-0.5">
                <span className="font-mono">{r.tgUserId}</span>
                {r.label && <span className="ml-2 text-muted-foreground">— {r.label}</span>}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm(t('whitelistRemoveConfirm', { id: r.tgUserId })))
                    remove.mutate(r.tgUserId);
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
