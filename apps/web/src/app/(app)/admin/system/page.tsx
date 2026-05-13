'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useCollapsibleSection } from '@/lib/hooks/use-collapsible-section';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api/client';
import type {
  ConfigGroup,
  ConfigSection,
  ConfigSpec,
  MergedConfigEntry,
  ProvidersListResponse,
  SystemStats,
} from '@/lib/api/types';
import { formatBytes } from '@/lib/utils';

import { AddProviderDialog } from './_components/add-provider-dialog';
import { ClaudeStatusBlock } from './_components/claude-status-block';
import { ProviderCard } from './_components/provider-card';
import { PerFeatureSelector } from './_components/per-feature-selector';
import { TelegramSection } from './_components/telegram-section';
import { TokensSection } from './_components/tokens-section';

const SECTION_ORDER: ConfigSection[] = [
  'providers',
  'ingestion',
  'enrichment',
  'whisper',
  'search',
  'api',
  'projects',
  'telegram',
  'storage',
  'advanced',
];

// Map a spec.group → fallback section when the server hasn't declared one
// (back-compat for any spec that pre-dates ADR-0049). The server now sets
// `section` on every shipping spec; this is purely defensive.
const GROUP_TO_SECTION: Record<ConfigGroup, ConfigSection> = {
  imports: 'ingestion',
  parsers: 'ingestion',
  enrichment: 'enrichment',
  vision: 'enrichment',
  whisper: 'whisper',
  claude: 'enrichment',
  worker: 'advanced',
  providers: 'providers',
  projects: 'projects',
  telegram: 'telegram',
  search: 'search',
  api: 'api',
};

// `useCollapsibleSection` is shared with the dedicated cards
// (TelegramSection, TokensSection) so every block on /admin/system
// remembers its collapse state with the same localStorage scheme.

function sectionOf(entry: MergedConfigEntry): ConfigSection {
  return entry.spec.section ?? GROUP_TO_SECTION[entry.spec.group] ?? 'advanced';
}

export default function AdminSystemPage(): JSX.Element {
  const t = useTranslations('admin.system');
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: () => api.get<SystemStats>('/system/stats'),
  });

  const config = useQuery({
    queryKey: ['system', 'config'],
    queryFn: () => api.get<MergedConfigEntry[]>('/system/config'),
  });

  const providers = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: () => api.get<ProvidersListResponse>('/admin/providers'),
  });

  const grouped = useMemo(() => {
    const out = new Map<ConfigSection, MergedConfigEntry[]>();
    for (const e of config.data ?? []) {
      if (sectionOf(e) === 'providers') continue; // dedicated card renders these
      const list = out.get(sectionOf(e)) ?? [];
      list.push(e);
      out.set(sectionOf(e), list);
    }
    return out;
  }, [config.data]);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.patch(`/system/config`, { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('saveFailed')),
  });

  const reset = useMutation({
    mutationFn: (key: string) => api.delete(`/system/config/${encodeURIComponent(key)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
      toast.success(t('resetSuccess'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('resetFailed')),
  });

  // `restarting` blanks the whole page with an overlay so the user
  // can't change anything while consumers are mid-reload. POST
  // /system/restart returns immediately (the pubsub publish is async);
  // worker/orchestrator hot-reload takes <1s in practice, but we hold
  // the overlay 2.5s to absorb the worst case + refetch /system/config
  // so any post-reload state diff shows up.
  const [restarting, setRestarting] = useState(false);
  const restart = useMutation({
    mutationFn: () => api.post('/system/restart'),
    onSuccess: () => {
      setRestarting(true);
      window.setTimeout(() => {
        setRestarting(false);
        queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] });
        queryClient.invalidateQueries({ queryKey: ['system', 'stats'] });
        toast.success(t('restartTriggered'));
      }, 2500);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('restartFailed')),
  });

  return (
    <div className="relative">
      {(restarting || restart.isPending) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-8 py-6 shadow-xl">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <p className="text-sm font-medium">{t('restartingTitle')}</p>
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {t('restartingHint')}
            </p>
          </div>
        </div>
      )}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => restart.mutate()}
            disabled={restart.isPending || restarting}
            title={t('restartHint')}
          >
            <RefreshCw
              className={restart.isPending || restarting ? 'size-4 animate-spin' : 'size-4'}
            />
            {t('restartServices')}
          </Button>
        }
      />
      <div className="space-y-4 px-8 py-6">
        {/* ---- AI Providers card (the new hero) ---- */}
        <ProvidersSection
          providers={providers.data}
          isLoading={providers.isLoading}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] });
            queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
          }}
        />

        {/* ---- All non-provider sections ---- */}
        {SECTION_ORDER.filter((s) => s !== 'providers').map((section) => {
          if (section === 'storage') {
            return <StorageCard key={section} stats={stats.data} isLoading={stats.isLoading} />;
          }
          // Telegram has its own custom block (token + whitelist + registry rows).
          if (section === 'telegram') {
            return <TelegramSection key={section} />;
          }
          const entries = grouped.get(section);
          if (!entries || entries.length === 0) return null;
          return (
            <SectionCard
              key={section}
              section={section}
              entries={entries}
              saving={save.isPending}
              onSave={(key, value) => save.mutate({ key, value })}
              onReset={(key) => reset.mutate(key)}
            />
          );
        })}

        {/* API tokens used to live at /admin/tokens; folded into System after v1 menu consolidation. */}
        <TokensSection />

        {config.isLoading && <Skeleton className="h-24 w-full" />}
      </div>
    </div>
  );
}

function ProvidersSection({
  providers,
  isLoading,
  onChanged,
}: {
  providers: ProvidersListResponse | undefined;
  isLoading: boolean;
  onChanged: () => void;
}): JSX.Element {
  const t = useTranslations('admin.system.sections.providers');
  const tProv = useTranslations('admin.providers');
  const [addOpen, setAddOpen] = useState(false);
  const [open, toggle] = useCollapsibleSection('providers');

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <button type="button" className="flex-1 cursor-pointer text-left" onClick={toggle}>
          <CardTitle className="flex items-center gap-2">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <span>{t('title')}</span>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </button>
        {open && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> {tProv('addProvider')}
          </Button>
        )}
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {isLoading && <Skeleton className="h-24 w-full" />}
          {providers && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {providers.providers.map((p) => (
                  <ProviderCard key={p.id} provider={p} onChanged={onChanged} />
                ))}
              </div>
              <PerFeatureSelector
                defaults={providers.defaults}
                providers={providers.providers}
                onChanged={onChanged}
              />
              {/* Claude CLI is one of the built-in providers; its rate-limit + test surface is here. */}
              <ClaudeStatusBlock />
            </>
          )}
        </CardContent>
      )}
      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          onChanged();
        }}
      />
    </Card>
  );
}

function StorageCard({
  stats,
  isLoading,
}: {
  stats: SystemStats | undefined;
  isLoading: boolean;
}): JSX.Element {
  const t = useTranslations('admin.system.sections.storage');
  const tStats = useTranslations('admin.system.stats');
  const [open, toggle] = useCollapsibleSection('storage');
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={toggle}>
        <CardTitle className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2 text-sm">
          {isLoading && <Skeleton className="h-5 w-full" />}
          {stats && (
            <>
              <StatRow label={tStats('documents')} value={stats.documents} />
              <StatRow label={tStats('entities')} value={stats.entities} />
              <StatRow label={tStats('edges')} value={stats.edges} />
              <StatRow label={tStats('projects')} value={stats.projects} />
              <StatRow label={tStats('decisions')} value={stats.decisions} />
              <StatRow label={tStats('dbSize')} value={formatBytes(stats.dbSizeBytes)} />
              <p className="pt-2 text-[11px] text-muted-foreground">{t('backupNote')}</p>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SectionCard({
  section,
  entries,
  saving,
  onSave,
  onReset,
}: {
  section: ConfigSection;
  entries: MergedConfigEntry[];
  saving: boolean;
  onSave: (key: string, value: unknown) => void;
  onReset: (key: string) => void;
}): JSX.Element {
  const t = useTranslations(`admin.system.sections.${section}`);
  const [open, toggle] = useCollapsibleSection(section);
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={toggle}>
        <CardTitle className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {t('title')}
          <Badge variant="outline" className="text-[10px]">
            {entries.length}
          </Badge>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6">
          {entries.map((entry) => (
            <ConfigRow
              key={entry.spec.key}
              entry={entry}
              saving={saving}
              onSave={(value) => onSave(entry.spec.key, value)}
              onReset={() => onReset(entry.spec.key)}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

interface ConfigRowProps {
  entry: MergedConfigEntry;
  saving: boolean;
  onSave: (value: unknown) => void;
  onReset: () => void;
}

function ConfigRow({ entry, saving, onSave, onReset }: ConfigRowProps): JSX.Element {
  const { spec, value, overridden } = entry;
  const t = useTranslations('admin.system');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="font-mono text-xs text-muted-foreground">{spec.key}</Label>
        {overridden && (
          <Badge variant="outline" className="text-[10px]">
            {t('overridden')}
          </Badge>
        )}
        {spec.requiresRestart && (
          <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-300">
            {t('restartRequired')}
          </Badge>
        )}
        {overridden && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title={t('reset')}
          >
            <RotateCcw className="h-3 w-3" /> {t('reset')}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{spec.description}</p>
      <ConfigControl spec={spec} value={value} saving={saving} onSave={onSave} />
    </div>
  );
}

function ConfigControl({
  spec,
  value,
  saving,
  onSave,
}: {
  spec: ConfigSpec;
  value: unknown;
  saving: boolean;
  onSave: (value: unknown) => void;
}): JSX.Element {
  switch (spec.type) {
    case 'bool':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={Boolean(value)}
            onCheckedChange={(checked) => onSave(checked === true)}
            disabled={saving}
          />
          <span className="text-sm">{value ? 'enabled' : 'disabled'}</span>
        </div>
      );
    case 'enum':
      return (
        <Select value={String(value ?? '')} onValueChange={(v) => onSave(v)} disabled={saving}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spec.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'bytes':
      return (
        <BytesControl
          spec={spec}
          value={Number(value ?? spec.default)}
          saving={saving}
          onSave={onSave}
        />
      );
    case 'int':
      return (
        <NumberControl
          value={Number(value ?? spec.default)}
          min={spec.min}
          max={spec.max}
          saving={saving}
          onSave={onSave}
        />
      );
    case 'string':
    default:
      return (
        <StringControl
          value={typeof value === 'string' ? value : String(value ?? '')}
          saving={saving}
          onSave={onSave}
        />
      );
  }
}

function BytesControl({
  spec,
  value,
  saving,
  onSave,
}: {
  spec: Extract<ConfigSpec, { type: 'bytes' }>;
  value: number;
  saving: boolean;
  onSave: (value: number) => void;
}): JSX.Element {
  const t = useTranslations('admin.system.errors');
  const [display, setDisplay] = useState(() => bytesToHuman(value));
  useEffect(() => {
    setDisplay(bytesToHuman(value));
  }, [value]);

  const commit = (): void => {
    const parsed = humanToBytes(display);
    if (parsed === null) {
      toast.error(t('bytesParse', { value: display }));
      setDisplay(bytesToHuman(value));
      return;
    }
    if (spec.min !== undefined && parsed < spec.min) {
      toast.error(t('bytesBelowMin', { min: formatBytes(spec.min) }));
      return;
    }
    if (spec.max != null && parsed > spec.max) {
      toast.error(t('bytesAboveMax', { max: formatBytes(spec.max) }));
      return;
    }
    if (parsed !== value) onSave(parsed);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          disabled={saving}
          className="w-48 font-mono"
        />
        <span className="text-xs text-muted-foreground">
          = {value.toLocaleString()} bytes ({formatBytes(value)})
        </span>
      </div>
      {spec.presets && spec.presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {spec.presets.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={saving}
              onClick={() => onSave(preset)}
            >
              {formatBytes(preset)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberControl({
  value,
  min,
  max,
  saving,
  onSave,
}: {
  value: number;
  min?: number;
  max?: number;
  saving: boolean;
  onSave: (value: number) => void;
}): JSX.Element {
  const t = useTranslations('admin.system.errors');
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (): void => {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed)) {
      toast.error(t('intParse', { value: text }));
      setText(String(value));
      return;
    }
    if (min !== undefined && parsed < min) {
      toast.error(t('intMin', { min }));
      return;
    }
    if (max !== undefined && parsed > max) {
      toast.error(t('intMax', { max }));
      return;
    }
    if (parsed !== value) onSave(parsed);
  };

  return (
    <Input
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      min={min}
      max={max}
      disabled={saving}
      className="w-32 font-mono"
    />
  );
}

function StringControl({
  value,
  saving,
  onSave,
}: {
  value: string;
  saving: boolean;
  onSave: (value: string) => void;
}): JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onSave(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (text !== value) onSave(text);
        }
      }}
      disabled={saving}
      className="w-full font-mono"
    />
  );
}

// ---- Bytes parsing ----------------------------------------------------------

function bytesToHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';
  const units: [string, number][] = [
    ['TiB', 1024 ** 4],
    ['GiB', 1024 ** 3],
    ['MiB', 1024 ** 2],
    ['KiB', 1024],
  ];
  for (const [unit, base] of units) {
    if (bytes >= base && bytes % base === 0) return `${bytes / base} ${unit}`;
  }
  for (const [unit, base] of units) {
    if (bytes >= base) return `${(bytes / base).toFixed(2)} ${unit}`;
  }
  return `${bytes} B`;
}

function humanToBytes(input: string): number | null {
  const cleaned = input.trim().replace(/[, ]+/g, '');
  if (/^\d+$/.test(cleaned)) return Number.parseInt(cleaned, 10);
  const m = cleaned.match(/^(\d+(?:\.\d+)?)([KMGT])(I)?B?$/i);
  if (!m) return null;
  const numStr = m[1];
  const unitChar = m[2];
  if (!numStr || !unitChar) return null;
  const num = Number.parseFloat(numStr);
  if (!Number.isFinite(num)) return null;
  const unit = unitChar.toUpperCase();
  const binary = !!m[3];
  const base = binary ? 1024 : 1000;
  const mult: Record<string, number> = {
    K: base,
    M: base ** 2,
    G: base ** 3,
    T: base ** 4,
  };
  return Math.round(num * (mult[unit] ?? 1));
}
