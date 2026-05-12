'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { ConfigGroup, ConfigSpec, MergedConfigEntry, SystemStats } from '@/lib/api/types';
import { formatBytes } from '@/lib/utils';

const GROUP_LABELS: Record<ConfigGroup, string> = {
  imports: 'Imports',
  parsers: 'Parsers',
  enrichment: 'Enrichment',
  worker: 'Worker (ingestion + transcription)',
  vision: 'Vision (image analysis)',
  whisper: 'Whisper',
  claude: 'Claude',
};

const GROUP_ORDER: ConfigGroup[] = [
  'imports',
  'parsers',
  'enrichment',
  'worker',
  'vision',
  'whisper',
  'claude',
];

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

  const grouped = useMemo(() => groupByConfigGroup(config.data ?? []), [config.data]);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.patch(`/system/config`, { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
      toast.success('Saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to save'),
  });

  const reset = useMutation({
    mutationFn: (key: string) => api.delete(`/system/config/${encodeURIComponent(key)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'config'] });
      toast.success('Reset to default');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to reset'),
  });

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-4 px-8 py-6 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {stats.isLoading && <Skeleton className="h-5 w-full" />}
              {stats.data && (
                <>
                  <StatRow label="Documents" value={stats.data.documents} />
                  <StatRow label="Entities" value={stats.data.entities} />
                  <StatRow label="Edges" value={stats.data.edges} />
                  <StatRow label="Projects" value={stats.data.projects} />
                  <StatRow label="Decisions" value={stats.data.decisions} />
                  <StatRow label="DB size" value={formatBytes(stats.data.dbSizeBytes)} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {config.isLoading && <Skeleton className="h-64 w-full" />}
          {GROUP_ORDER.map((group) => {
            const entries = grouped.get(group);
            if (!entries || entries.length === 0) return null;
            return (
              <Card key={group}>
                <CardHeader>
                  <CardTitle>{GROUP_LABELS[group]}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {entries.map((entry) => (
                    <ConfigRow
                      key={entry.spec.key}
                      entry={entry}
                      saving={save.isPending}
                      onSave={(value) => save.mutate({ key: entry.spec.key, value })}
                      onReset={() => reset.mutate(entry.spec.key)}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function groupByConfigGroup(entries: MergedConfigEntry[]): Map<ConfigGroup, MergedConfigEntry[]> {
  const out = new Map<ConfigGroup, MergedConfigEntry[]>();
  for (const e of entries) {
    const list = out.get(e.spec.group) ?? [];
    list.push(e);
    out.set(e.spec.group, list);
  }
  return out;
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="font-mono text-xs text-muted-foreground">{spec.key}</Label>
        {overridden && (
          <Badge variant="outline" className="text-[10px]">
            overridden
          </Badge>
        )}
        {spec.requiresRestart && (
          <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-300">
            restart required
          </Badge>
        )}
        {overridden && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" /> reset
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
  const [display, setDisplay] = useState(() => bytesToHuman(value));
  useEffect(() => {
    setDisplay(bytesToHuman(value));
  }, [value]);

  const commit = (): void => {
    const parsed = humanToBytes(display);
    if (parsed === null) {
      toast.error(`Could not parse "${display}" — try formats like "5GiB", "2 GB", or "1048576".`);
      setDisplay(bytesToHuman(value));
      return;
    }
    if (spec.min !== undefined && parsed < spec.min) {
      toast.error(`Below minimum (${formatBytes(spec.min)})`);
      return;
    }
    if (spec.max != null && parsed > spec.max) {
      toast.error(`Above maximum (${formatBytes(spec.max)})`);
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
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (): void => {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed)) {
      toast.error(`"${text}" is not a valid integer`);
      setText(String(value));
      return;
    }
    if (min !== undefined && parsed < min) {
      toast.error(`Min is ${min}`);
      return;
    }
    if (max !== undefined && parsed > max) {
      toast.error(`Max is ${max}`);
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
