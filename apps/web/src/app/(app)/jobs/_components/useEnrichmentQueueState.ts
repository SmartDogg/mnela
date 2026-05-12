'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { EnrichmentQueueState } from '@/lib/api/types';
import { useLiveEvents } from '@/lib/socket/useLiveEvents';

/**
 * Snapshot of the enrichment queue, kept fresh by:
 *   1. GET /jobs/queue-state on first mount (and as fallback poll)
 *   2. Socket.io `enrichment.queue.tick` events patching the cache directly
 *      via cacheSync (apps/web/src/lib/socket/cacheSync.ts)
 *
 * Polling cadence drops to a long fallback while the socket is connected —
 * the tick event arrives every ~4s anyway. If the socket falls over,
 * useQuery resumes polling at 5s so the page never freezes.
 */
export function useEnrichmentQueueState(): {
  data: EnrichmentQueueState | undefined;
  isLoading: boolean;
} {
  const live = useLiveEvents();
  const connected = live.status === 'connected';
  const query = useQuery<EnrichmentQueueState>({
    queryKey: ['jobs', 'queue-state'],
    queryFn: () => api.get<EnrichmentQueueState>('/jobs/queue-state'),
    refetchInterval: connected ? 30_000 : 5_000,
  });
  return { data: query.data, isLoading: query.isLoading };
}
