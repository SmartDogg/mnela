'use client';

import { Loader2, Pause, Play, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api/client';
import type { EnrichmentQueueState } from '@/lib/api/types';
import { useLiveSocketStore } from '@/lib/socket/store';
import { cn } from '@/lib/utils';

import { formatElapsedShort, formatEtaLong, formatMs } from './format';
import { useNow } from './useNow';

const VISIBLE_NOW_PROCESSING = 5;

interface Props {
  state: EnrichmentQueueState | undefined;
  isLoading: boolean;
}

export function EnrichmentSection({ state, isLoading }: Props): JSX.Element {
  const qc = useQueryClient();
  const now = useNow();
  const enriching = useLiveSocketStore(useShallow((s) => s.enriching));
  const [expanded, setExpanded] = useState(false);

  const pause = useMutation({
    mutationFn: () => api.post('/jobs/queue/pause'),
    onSuccess: () => {
      qc.setQueryData<EnrichmentQueueState | undefined>(['jobs', 'queue-state'], (old) =>
        old ? { ...old, paused: true, userPaused: true } : old,
      );
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Pause failed'),
  });
  const resume = useMutation({
    mutationFn: () => api.post('/jobs/queue/resume'),
    onSuccess: () => {
      qc.setQueryData<EnrichmentQueueState | undefined>(['jobs', 'queue-state'], (old) =>
        old ? { ...old, paused: false, userPaused: false } : old,
      );
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Resume failed'),
  });

  if (!state && isLoading) {
    return (
      <SectionShell title="Enrichment">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      </SectionShell>
    );
  }
  if (!state) {
    return (
      <SectionShell title="Enrichment">
        <p className="text-xs text-muted-foreground">Queue state unavailable.</p>
      </SectionShell>
    );
  }

  const eta = etaSeconds(state);
  const inFlight = Array.from(enriching.values()).sort((a, b) => a.startedAtMs - b.startedAtMs);
  const visible = expanded ? inFlight : inFlight.slice(0, VISIBLE_NOW_PROCESSING);
  const more = inFlight.length - visible.length;
  const togglePaused = state.userPaused ? () => resume.mutate() : () => pause.mutate();
  const pendingToggle = pause.isPending || resume.isPending;

  return (
    <SectionShell
      title="Enrichment"
      trailing={
        <div className="flex items-center gap-2">
          <SettingsBadge>
            <span className="font-mono">parallelism {state.parallelism}</span>
            <span>·</span>
            <span className={state.useSlot ? '' : 'text-amber-300'}>
              slot {state.useSlot ? 'on' : 'off'}
            </span>
          </SettingsBadge>
          <Button
            size="sm"
            variant={state.userPaused ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={togglePaused}
            disabled={pendingToggle}
            data-testid="queue-pause-toggle"
          >
            {pendingToggle ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : state.userPaused ? (
              <Play className="h-3 w-3" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
            <span className="text-[11px]">{state.userPaused ? 'Resume queue' : 'Pause queue'}</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Counter label="Active" value={state.active} tone={state.active > 0 ? 'live' : 'muted'} />
        <Counter label="Waiting" value={state.waiting} />
        <Counter label="Delayed" value={state.delayed} />
        <Counter
          label="Failed"
          value={state.failed}
          tone={state.failed > 0 ? 'destructive' : 'muted'}
        />
        <Counter label="Done/h" value={state.completedLastHour} />
        <Counter
          label="ETA"
          value={formatEtaLong(eta)}
          tone={state.waiting + state.active > 0 ? 'live' : 'muted'}
        />
        {state.p50DurationMs > 0 && <Counter label="p50" value={formatMs(state.p50DurationMs)} />}
        {state.ratePerMinute > 0 && <Counter label="rate" value={`${state.ratePerMinute}/min`} />}
      </div>

      <PauseBanner state={state} />

      {inFlight.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {visible.map((doc) => (
            <li key={doc.documentId} className="flex items-center gap-2">
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse')}
              />
              <Link
                href={`/documents/${encodeURIComponent(doc.documentId)}`}
                className="flex-1 truncate font-mono text-[11px] hover:underline"
              >
                {doc.title || doc.documentId}
              </Link>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatElapsedShort(now - doc.startedAtMs)}
              </span>
            </li>
          ))}
          {more > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                show {more} more …
              </button>
            </li>
          )}
          {expanded && inFlight.length > VISIBLE_NOW_PROCESSING && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                collapse
              </button>
            </li>
          )}
        </ul>
      )}

      {inFlight.length === 0 && (state.waiting > 0 || state.delayed > 0) && (
        <p className="mt-2 text-[11px] text-muted-foreground">Waiting to pick up next document…</p>
      )}
    </SectionShell>
  );
}

function PauseBanner({ state }: { state: EnrichmentQueueState }): JSX.Element | null {
  if (!state.paused && !state.rateLimitedUntil) return null;
  const lines: string[] = [];
  if (state.userPaused) lines.push('Queue is paused manually — resume to continue.');
  if (state.rateLimitedUntil) {
    const until = new Date(state.rateLimitedUntil);
    if (!Number.isNaN(until.getTime())) {
      lines.push(`Anthropic rate-limit hit; auto-resumes at ${until.toLocaleTimeString()}.`);
    }
  }
  if (state.slotHolder && state.slotHolder !== 'enrichment') {
    lines.push(`Yielding shared Claude slot to ${state.slotHolder} (ADR-0027).`);
  }
  if (lines.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

function Counter({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number | string;
  tone?: 'muted' | 'live' | 'destructive';
}): JSX.Element {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-mono tabular-nums',
          tone === 'destructive'
            ? 'text-red-400'
            : tone === 'live'
              ? 'text-foreground'
              : 'text-foreground/80',
        )}
      >
        {value}
      </span>
    </span>
  );
}

function SettingsBadge({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Link
      href="/admin/system"
      className="inline-flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      title="Edit in /admin/system"
    >
      <Settings2 className="h-3 w-3" />
      {children}
    </Link>
  );
}

function SectionShell({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

/**
 * ETA in seconds, computed as (waiting + active) / (rate per second). Falls
 * back to null when there's nothing in flight or the rate is unknown (the
 * orchestrator hasn't completed enough docs in the last minute yet).
 */
function etaSeconds(state: EnrichmentQueueState): number | null {
  const remaining = state.waiting + state.active;
  if (remaining <= 0) return 0;
  if (state.ratePerMinute > 0) {
    return Math.round((remaining * 60) / state.ratePerMinute);
  }
  // Best-effort from p50 + parallelism while we wait for sliding-window data
  // to fill in.
  if (state.p50DurationMs > 0 && state.parallelism > 0) {
    return Math.round((remaining * state.p50DurationMs) / state.parallelism / 1000);
  }
  return null;
}
