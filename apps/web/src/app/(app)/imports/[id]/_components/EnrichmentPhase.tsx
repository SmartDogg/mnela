'use client';

import Link from 'next/link';

import { useEnrichmentQueueState } from '../../../jobs/_components/useEnrichmentQueueState';
import { formatEtaLong, formatMs } from '../../../jobs/_components/format';

import type { LiveImportDocument } from '@/lib/socket/types';
import { cn } from '@/lib/utils';

interface EnrichmentPhaseProps {
  documents: LiveImportDocument[];
}

/**
 * Compact "enrichment phase" strip for /imports/:id, rendered just under
 * the ingestion progress header. Splits visibility cleanly:
 *
 *   • Per-import counts (left): how many of THIS import's docs have moved
 *     past `parsed` to `enriching` / `enriched` / `failed`.
 *   • Global queue (right): a tiny mirror of the /jobs Enrichment section
 *     — total waiting, rate, ETA, paused/rate-limit banner. Click any of
 *     it to jump to /jobs for the full live view.
 *
 * The two halves answer different questions ("am I done?" vs "is the
 * orchestrator stuck?") without forcing the user to open another page.
 */
export function EnrichmentPhase({ documents }: EnrichmentPhaseProps): JSX.Element | null {
  const queue = useEnrichmentQueueState();

  const local = documents.reduce(
    (acc, d) => {
      if (d.status === 'enriching') acc.enriching += 1;
      else if (d.status === 'enriched') acc.enriched += 1;
      else if (d.status === 'failed') acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { enriched: 0, enriching: 0, failed: 0, pending: 0 },
  );

  const totalCandidates = local.enriched + local.enriching + local.failed + local.pending;
  // Hide when the import has produced no documents yet — the strip would
  // be all zeros and the ingestion progress already speaks for it.
  if (totalCandidates === 0) return null;

  const q = queue.data;
  const eta = q ? etaSeconds(q) : null;
  const showBanner = q?.paused || q?.rateLimitedUntil;
  const showSettingsBadge = q && (q.parallelism > 1 || !q.useSlot);

  return (
    <div className="border-b bg-background/40 px-8 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Enrichment
          </span>
          <span className="font-mono tabular-nums">
            {local.enriched} / {totalCandidates}
          </span>
          {local.enriching > 0 && (
            <span className="font-mono tabular-nums text-amber-300">
              · {local.enriching} active
            </span>
          )}
          {local.failed > 0 && (
            <span className="font-mono tabular-nums text-red-400">· {local.failed} failed</span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {q && q.waiting + q.active > 0 && (
            <>
              <Stat label="Queue" value={`${q.waiting + q.active}`} />
              {q.ratePerMinute > 0 && <Stat label="rate" value={`${q.ratePerMinute}/min`} />}
              {q.p50DurationMs > 0 && <Stat label="p50" value={formatMs(q.p50DurationMs)} />}
              <Stat label="ETA" value={formatEtaLong(eta)} />
            </>
          )}
          {showSettingsBadge && (
            <Link
              href="/admin/system"
              className="inline-flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-[10px] hover:text-foreground"
            >
              parallelism {q?.parallelism} · slot {q?.useSlot ? 'on' : 'off'}
            </Link>
          )}
          <Link href="/jobs" className="text-[11px] hover:text-foreground">
            Queue →
          </Link>
        </div>
      </div>

      {showBanner && q && (
        <div
          className={cn(
            'mt-1 rounded border px-2 py-1 text-[10px]',
            q.rateLimitedUntil
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-zinc-500/40 bg-zinc-500/10 text-muted-foreground',
          )}
        >
          {q.userPaused && <p>Enrichment queue paused manually — resume on /jobs.</p>}
          {q.rateLimitedUntil && (
            <p>
              Rate-limited, auto-resumes at {new Date(q.rateLimitedUntil).toLocaleTimeString()}.
            </p>
          )}
          {q.slotHolder && q.slotHolder !== 'enrichment' && (
            <p>Yielding shared Claude slot to {q.slotHolder} (ADR-0027).</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="flex items-baseline gap-1">
      <span className="uppercase tracking-wider">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </span>
  );
}

interface QueueState {
  waiting: number;
  active: number;
  ratePerMinute: number;
  p50DurationMs: number;
  parallelism: number;
}

function etaSeconds(state: QueueState): number | null {
  const remaining = state.waiting + state.active;
  if (remaining <= 0) return 0;
  if (state.ratePerMinute > 0) {
    return Math.round((remaining * 60) / state.ratePerMinute);
  }
  if (state.p50DurationMs > 0 && state.parallelism > 0) {
    return Math.round((remaining * state.p50DurationMs) / state.parallelism / 1000);
  }
  return null;
}
