'use client';

import { useEffect, useState } from 'react';

/**
 * Re-render-driving "now" clock for live elapsed counters. Ticks once a
 * second (instead of `Date.now()` on every paint) so elapsed displays
 * update smoothly without re-running expensive selectors per frame.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
