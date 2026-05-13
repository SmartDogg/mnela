'use client';

import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, api } from '@/lib/api/client';
import type { LlmProviderRow, ProviderFeatureKey, ProvidersListResponse } from '@/lib/api/types';

const FEATURE_ORDER: Exclude<ProviderFeatureKey, 'default'>[] = [
  'ask',
  'enrichment',
  'vision',
  'projectContext',
];

const FALLBACK_VALUE = '__fallback__';

export function PerFeatureSelector({
  defaults,
  providers,
  onChanged,
}: {
  defaults: ProvidersListResponse['defaults'];
  providers: LlmProviderRow[];
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.providers.routing');

  const setDefault = useMutation({
    mutationFn: (input: { feature: ProviderFeatureKey; providerId: string }) =>
      api.post('/admin/providers/defaults', input),
    onSuccess: () => {
      toast.success(t('saved'));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('saveFailed')),
  });

  const applyAll = useMutation({
    mutationFn: (providerId: string) =>
      api.post('/admin/providers/defaults/apply-all', { providerId }),
    onSuccess: () => {
      toast.success(t('applied'));
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('applyFailed')),
  });

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider">{t('title')}</h3>
          <p className="text-[11px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={applyAll.isPending}
          onClick={() => applyAll.mutate(defaults.default)}
        >
          <Check className="size-3" /> {t('applyAll')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ProviderSelect
          label={t('features.default')}
          fallbackLabel={t('fallback')}
          value={defaults.default || ''}
          providers={providers}
          allowFallback={false}
          onSave={(v) => setDefault.mutate({ feature: 'default', providerId: v })}
        />
        {FEATURE_ORDER.map((feature) => (
          <ProviderSelect
            key={feature}
            label={t(`features.${feature}`)}
            fallbackLabel={t('fallback')}
            value={defaults[feature] || ''}
            providers={providers}
            allowFallback
            onSave={(v) => setDefault.mutate({ feature, providerId: v })}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderSelect({
  label,
  fallbackLabel,
  value,
  providers,
  allowFallback,
  onSave,
}: {
  label: string;
  fallbackLabel: string;
  value: string;
  providers: LlmProviderRow[];
  allowFallback: boolean;
  onSave: (value: string) => void;
}): JSX.Element {
  const tProv = useTranslations('admin.providers');
  const display = value === '' ? FALLBACK_VALUE : value;
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={display} onValueChange={(v) => onSave(v === FALLBACK_VALUE ? '' : v)}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowFallback && (
            <SelectItem value={FALLBACK_VALUE}>
              <span className="text-muted-foreground">{fallbackLabel}</span>
            </SelectItem>
          )}
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.builtin && (
                <span className="ml-2 text-[10px] text-muted-foreground">({tProv('builtin')})</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
