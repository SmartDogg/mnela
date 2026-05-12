import { create } from 'zustand';

import type {
  EventFilter,
  GraphEdgeLike,
  GraphEntityLike,
  LiveStatus,
  MnelaEvent,
  RecordedEvent,
} from './types';

const MAX_EVENT_RING = 50;

/**
 * In-flight enrichment record — populated from `enrichment.document.started`
 * and removed on `enrichment.document.finished`. /jobs and /imports/:id read
 * this map to paint the "now processing" list with live elapsed timers.
 */
export interface EnrichingDocument {
  documentId: string;
  jobId: string;
  title?: string;
  kind: 'document' | 'image' | 'project';
  startedAtMs: number;
}

export interface LiveSocketState {
  status: LiveStatus;
  lastEvents: RecordedEvent[];
  graphNodes: Map<string, GraphEntityLike>;
  graphEdges: Map<string, GraphEdgeLike>;
  enriching: Map<string, EnrichingDocument>;
  pushEvent: (event: MnelaEvent, ts?: number) => void;
  setStatus: (status: LiveStatus) => void;
  clearGraph: () => void;
  reset: () => void;
}

function applyGraphMutation(
  state: Pick<LiveSocketState, 'graphNodes' | 'graphEdges' | 'enriching'>,
  event: MnelaEvent,
): Partial<Pick<LiveSocketState, 'graphNodes' | 'graphEdges' | 'enriching'>> {
  switch (event.type) {
    case 'graph.node_added': {
      const next = new Map(state.graphNodes);
      next.set(event.payload.entity.id, event.payload.entity);
      return { graphNodes: next };
    }
    case 'graph.edge_added': {
      const next = new Map(state.graphEdges);
      next.set(event.payload.edge.id, event.payload.edge);
      return { graphEdges: next };
    }
    case 'graph.node_updated': {
      const existing = state.graphNodes.get(event.payload.entityId);
      if (!existing) return {};
      const next = new Map(state.graphNodes);
      // Shallow merge — only `name`/`type` survive narrowing; everything else
      // is opaque metadata for the page-level renderer.
      const merged: GraphEntityLike = {
        ...existing,
        ...(typeof event.payload.changes['name'] === 'string'
          ? { name: event.payload.changes['name'] as string }
          : {}),
        ...(typeof event.payload.changes['type'] === 'string'
          ? { type: event.payload.changes['type'] as string }
          : {}),
      };
      next.set(existing.id, merged);
      return { graphNodes: next };
    }
    case 'enrichment.document.started': {
      const next = new Map(state.enriching);
      const startedAtMs = Date.parse(event.payload.startedAt);
      next.set(event.payload.documentId, {
        documentId: event.payload.documentId,
        jobId: event.payload.jobId,
        ...(event.payload.title ? { title: event.payload.title } : {}),
        kind: event.payload.kind,
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      });
      return { enriching: next };
    }
    case 'enrichment.document.finished': {
      if (!state.enriching.has(event.payload.documentId)) return {};
      const next = new Map(state.enriching);
      next.delete(event.payload.documentId);
      return { enriching: next };
    }
    default:
      return {};
  }
}

export const useLiveSocketStore = create<LiveSocketState>((set) => ({
  status: 'idle',
  lastEvents: [],
  graphNodes: new Map(),
  graphEdges: new Map(),
  enriching: new Map(),
  pushEvent: (event, ts = Date.now()) =>
    set((state) => {
      const trimmed =
        state.lastEvents.length >= MAX_EVENT_RING
          ? state.lastEvents.slice(state.lastEvents.length - MAX_EVENT_RING + 1)
          : state.lastEvents;
      const lastEvents: RecordedEvent[] = [...trimmed, { ts, event }];
      return { lastEvents, ...applyGraphMutation(state, event) };
    }),
  setStatus: (status) => set({ status }),
  clearGraph: () => set({ graphNodes: new Map(), graphEdges: new Map() }),
  reset: () =>
    set({
      status: 'idle',
      lastEvents: [],
      graphNodes: new Map(),
      graphEdges: new Map(),
      enriching: new Map(),
    }),
}));

function eventMatchesJobId(event: MnelaEvent, jobId: string): boolean {
  if ('jobId' in event.payload && typeof event.payload.jobId === 'string') {
    return event.payload.jobId === jobId;
  }
  return false;
}

export function filterEvents(events: RecordedEvent[], filter?: EventFilter): RecordedEvent[] {
  if (!filter || (!filter.jobId && (!filter.types || filter.types.length === 0))) return events;
  const types = filter.types && filter.types.length > 0 ? new Set(filter.types) : null;
  const { jobId } = filter;
  return events.filter(({ event }) => {
    if (types && !types.has(event.type)) return false;
    if (jobId && !eventMatchesJobId(event, jobId)) return false;
    return true;
  });
}

export const liveSocketSelectors = {
  status: (state: LiveSocketState): LiveStatus => state.status,
  lastEvents: (state: LiveSocketState): RecordedEvent[] => state.lastEvents,
  graphNodes: (state: LiveSocketState): Map<string, GraphEntityLike> => state.graphNodes,
  graphEdges: (state: LiveSocketState): Map<string, GraphEdgeLike> => state.graphEdges,
  enriching: (state: LiveSocketState): Map<string, EnrichingDocument> => state.enriching,
};

export const LIVE_EVENT_RING_SIZE = MAX_EVENT_RING;
