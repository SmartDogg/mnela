'use client';

import { useEffect, useMemo } from 'react';

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
 *
 * Implementation note: we read the raw, stable slices from the Zustand store
 * via narrow primitive selectors, then derive `events` / `lastEvent` via
 * useMemo over those slices. Applying `filterEvents` *inside* the Zustand
 * selector produces a new array reference on every render — even
 * `useShallow` cannot rescue that because its shallow compare looks at the
 * array reference, not its contents. The result was a "getSnapshot should
 * be cached" warning that escalated into "Maximum update depth exceeded"
 * loops in InboxPage and other live-feed consumers.
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

  const status = useLiveSocketStore((state) => state.status);
  const lastEvents = useLiveSocketStore((state) => state.lastEvents);

  return useMemo(() => {
    const events = filterEvents(lastEvents, stableFilter);
    const lastEvent = events.length > 0 ? (events[events.length - 1] ?? null) : null;
    return { status, events, lastEvent };
  }, [status, lastEvents, stableFilter]);
}

function noopHandler(_event: MnelaEvent): void {
  // The hook reads from the Zustand store directly; the subscription only
  // exists to keep the manager refcount accurate.
}
