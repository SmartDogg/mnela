export interface EtaResult {
  /** Estimated seconds until completion. `null` until we have a usable rate and a known total. */
  etaSeconds: number | null;
  /** Items processed per second since `startedAtMs`. Zero when no time has passed. */
  ratePerSec: number;
}

/**
 * Pure ETA calculator. Uses overall average rate since `startedAtMs` (not a
 * sliding window) — Phase 4 ingestion runs in seconds-to-minutes so a global
 * mean is stable enough and trivially testable.
 */
export function computeEta(
  processed: number,
  total: number | null,
  startedAtMs: number | null,
  nowMs: number,
): EtaResult {
  if (!startedAtMs || nowMs <= startedAtMs || processed <= 0) {
    return { etaSeconds: null, ratePerSec: 0 };
  }
  const elapsedSec = (nowMs - startedAtMs) / 1000;
  if (elapsedSec <= 0) return { etaSeconds: null, ratePerSec: 0 };
  const ratePerSec = processed / elapsedSec;
  if (total === null || total <= processed || ratePerSec <= 0) {
    return { etaSeconds: null, ratePerSec };
  }
  const remaining = total - processed;
  return { etaSeconds: Math.max(0, Math.round(remaining / ratePerSec)), ratePerSec };
}

/** Human-readable ETA: `12s`, `4m 30s`, `1h 12m`. */
export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null) return '—';
  if (etaSeconds < 60) return `${etaSeconds}s`;
  if (etaSeconds < 3600) {
    const m = Math.floor(etaSeconds / 60);
    const s = etaSeconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(etaSeconds / 3600);
  const m = Math.floor((etaSeconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
