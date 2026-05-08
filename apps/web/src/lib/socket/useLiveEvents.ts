'use client';

import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { subscribe } from './client';
import { filterEvents, useLiveSocketStore } from './store';
import type { EventFilter, LiveStatus, MnelaEvent, RecordedEvent } from './types';

export interface UseLiveEventsResult {
  status: LiveStatus;
  events: RecordedEvent[];
  lastEvent: RecordedEvent | null;
}

/**
 * Subscribe to the live event stream. The component is registered with the
 * singleton manager via refcount — first subscriber opens the socket, last
 * one closes it. Re-renders fire only when the (filter-narrowed) slice
 * actually changes.
 */
export function useLiveEvents(filter?: EventFilter): UseLiveEventsResult {
  const jobId = filter?.jobId;
  const typesKey = filter?.types?.slice().sort().join('|') ?? '';

  useEffect(() => {
    const off = subscribe(noopHandler);
    return off;
  }, []);

  const stableFilter = useMemo<EventFilter | undefined>(() => {
    if (!jobId && !typesKey) return undefined;
    return {
      jobId,
      types: typesKey ? (typesKey.split('|') as EventFilter['types']) : undefined,
    };
  }, [jobId, typesKey]);

  return useLiveSocketStore(
    useShallow((state) => {
      const events = filterEvents(state.lastEvents, stableFilter);
      const lastEvent = events.length > 0 ? (events[events.length - 1] ?? null) : null;
      return { status: state.status, events, lastEvent };
    }),
  );
}

function noopHandler(_event: MnelaEvent): void {
  // The hook reads from the Zustand store directly; the subscription only
  // exists to keep the manager refcount accurate.
}
