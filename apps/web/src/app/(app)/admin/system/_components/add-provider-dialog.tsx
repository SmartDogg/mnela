'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { LlmProviderKind, LlmProviderRow } from '@/lib/api/types';

interface CreatePayload {
  name: string;
  kind: Exclude<LlmProviderKind, 'claude_cli'>;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  extra?: Record<string, unknown>;
}

// Preset hints are intentionally English-only — they reference specific
// service names ("Anthropic API", "DeepSeek", "OpenRouter") that are brand
// identifiers and not translated in the underlying products either. Only the
// dialog chrome (labels, buttons, errors) is translated.
const PRESETS: {
  label: string;
  kind: CreatePayload['kind'];
  baseUrl?: string;
  model: string;
  hint: string;
}[] = [
  {
    label: 'Anthropic API',
    kind: 'anthropic_api',
    model: 'claude-sonnet-4-6',
    hint: 'Pay-per-token. Native tool-use.',
  },
  {
    label: 'OpenAI',
    kind: 'openai_compat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'gpt-4o, gpt-4o-mini, o3-mini.',
  },
  {
    label: 'DeepSeek',
    kind: 'openai_compat',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'Cheap chat + reasoning.',
  },
  {
    label: 'xAI Grok',
    kind: 'openai_compat',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-2-latest',
    hint: 'Native tool-use, vision on -vision models.',
  },
  {
    label: 'Gemini (OpenAI mode)',
    kind: 'openai_compat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    hint: 'Google AI Studio key.',
  },
  {
    label: 'OpenRouter',
    kind: 'openai_compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.7-sonnet',
    hint: 'Single key, many backends.',
  },
  {
    label: 'Ollama (local)',
    kind: 'openai_compat',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1:8b-instruct-q4_K_M',
    hint: 'No key needed.',
  },
  {
    label: 'LM Studio (local)',
    kind: 'openai_compat',
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-7b-instruct',
    hint: 'No key needed.',
  },
];

export function AddProviderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}): JSX.Element {
  const t = useTranslations('admin.providers.dialog');
  const tKinds = useTranslations('admin.providers.kinds');
  const [preset, setPreset] = useState<string>('Anthropic API');
  const [name, setName] = useState('Anthropic API');
  const [kind, setKind] = useState<CreatePayload['kind']>('anthropic_api');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [extra, setExtra] = useState('');

  const reset = (): void => {
    const p = PRESETS[0];
    if (!p) return;
    setPreset(p.label);
    setName(p.label);
    setKind(p.kind);
    setModel(p.model);
    setBaseUrl(p.baseUrl ?? '');
    setApiKey('');
    setExtra('');
  };

  const applyPreset = (label: string): void => {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    setPreset(p.label);
    setName(p.label);
    setKind(p.kind);
    setModel(p.model);
    setBaseUrl(p.baseUrl ?? '');
  };

  const create = useMutation({
    mutationFn: (payload: CreatePayload) => api.post<LlmProviderRow>('/admin/providers', payload),
    onSuccess: () => {
      toast.success(t('added'));
      onOpenChange(false);
      onCreated();
      reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('addFailed')),
  });

  const submit = (): void => {
    let parsedExtra: Record<string, unknown> | undefined;
    if (extra.trim().length > 0) {
      try {
        parsedExtra = JSON.parse(extra) as Record<string, unknown>;
      } catch {
        toast.error(t('extraInvalid'));
        return;
      }
    }
    const payload: CreatePayload = {
      name: name.trim(),
      kind,
      model: model.trim(),
    };
    if (kind === 'openai_compat') payload.baseUrl = baseUrl.trim();
    if (apiKey.length > 0) payload.apiKey = apiKey;
    if (parsedExtra) payload.extra = parsedExtra;
    create.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('preset')}</Label>
            <Select value={preset} onValueChange={applyPreset}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label}{' '}
                    <span className="ml-2 text-[10px] text-muted-foreground">— {p.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('kind')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CreatePayload['kind'])}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic_api">{tKinds('anthropic_api')}</SelectItem>
                <SelectItem value="openai_compat">{tKinds('openai_compat')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === 'openai_compat' && (
            <div className="space-y-1">
              <Label className="text-xs">{t('baseUrl')}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">{t('model')}</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('apiKey')}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('apiKeyPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('extra')}</Label>
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={t('extraPlaceholder')}
              rows={3}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
