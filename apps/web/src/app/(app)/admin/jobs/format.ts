// Pure formatting helpers for the job-stats dashboard. Kept separate from
// page.tsx so they can be unit-tested without rendering recharts.

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(2)}m`;
  return `${(ms / 3_600_000).toFixed(2)}h`;
}

export function formatBucketTs(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export type ErrorRateTone = 'ok' | 'warn' | 'bad';

export function errorRateTone(rate: number): ErrorRateTone {
  if (rate < 0.01) return 'ok';
  if (rate < 0.05) return 'warn';
  return 'bad';
}
