import { beforeEach, describe, expect, it } from 'vitest';

import { filterEvents, LIVE_EVENT_RING_SIZE, useLiveSocketStore } from '../store';
import type { MnelaEvent, RecordedEvent } from '../types';

function jobProgress(jobId: string, progress: number): MnelaEvent {
  return { type: 'job.progress', payload: { jobId, progress } };
}

beforeEach(() => {
  useLiveSocketStore.getState().reset();
});

describe('useLiveSocketStore', () => {
  it('starts idle with empty buffers', () => {
    const s = useLiveSocketStore.getState();
    expect(s.status).toBe('idle');
    expect(s.lastEvents).toEqual([]);
    expect(s.graphNodes.size).toBe(0);
    expect(s.graphEdges.size).toBe(0);
  });

  it('pushEvent appends and respects ring capacity', () => {
    for (let i = 0; i < LIVE_EVENT_RING_SIZE + 10; i += 1) {
      useLiveSocketStore.getState().pushEvent(jobProgress('j1', i), i);
    }
    const { lastEvents } = useLiveSocketStore.getState();
    expect(lastEvents).toHaveLength(LIVE_EVENT_RING_SIZE);
    const first = lastEvents[0];
    const last = lastEvents[lastEvents.length - 1];
    expect(first?.ts).toBe(10);
    expect(last?.ts).toBe(LIVE_EVENT_RING_SIZE + 10 - 1);
  });

  it('graph.node_added populates graphNodes', () => {
    const event: MnelaEvent = {
      type: 'graph.node_added',
      payload: { entity: { id: 'n1', name: 'Alpha', type: 'concept' } },
    };
    useLiveSocketStore.getState().pushEvent(event);
    const s = useLiveSocketStore.getState();
    expect(s.graphNodes.get('n1')).toEqual({ id: 'n1', name: 'Alpha', type: 'concept' });
  });

  it('graph.edge_added populates graphEdges', () => {
    const event: MnelaEvent = {
      type: 'graph.edge_added',
      payload: {
        edge: { id: 'e1', fromId: 'a', toId: 'b', relationType: 'links_to' },
      },
    };
    useLiveSocketStore.getState().pushEvent(event);
    expect(useLiveSocketStore.getState().graphEdges.get('e1')?.relationType).toBe('links_to');
  });

  it('graph.node_updated merges name onto existing entity, ignores unknown ids', () => {
    const store = useLiveSocketStore.getState();
    store.pushEvent({
      type: 'graph.node_added',
      payload: { entity: { id: 'n1', name: 'Old', type: 'concept' } },
    });
    store.pushEvent({
      type: 'graph.node_updated',
      payload: { entityId: 'n1', changes: { name: 'New' } },
    });
    expect(useLiveSocketStore.getState().graphNodes.get('n1')?.name).toBe('New');

    store.pushEvent({
      type: 'graph.node_updated',
      payload: { entityId: 'missing', changes: { name: 'Nope' } },
    });
    expect(useLiveSocketStore.getState().graphNodes.has('missing')).toBe(false);
  });

  it('clearGraph wipes graph maps but not events', () => {
    const store = useLiveSocketStore.getState();
    store.pushEvent({
      type: 'graph.node_added',
      payload: { entity: { id: 'n1', name: 'Alpha', type: 'concept' } },
    });
    store.clearGraph();
    const s = useLiveSocketStore.getState();
    expect(s.graphNodes.size).toBe(0);
    expect(s.lastEvents).toHaveLength(1);
  });

  it('setStatus transitions through expected states', () => {
    const store = useLiveSocketStore.getState();
    store.setStatus('connecting');
    expect(useLiveSocketStore.getState().status).toBe('connecting');
    store.setStatus('connected');
    expect(useLiveSocketStore.getState().status).toBe('connected');
    store.setStatus('unavailable');
    expect(useLiveSocketStore.getState().status).toBe('unavailable');
  });
});

describe('filterEvents', () => {
  const events: RecordedEvent[] = [
    { ts: 1, event: { type: 'job.progress', payload: { jobId: 'a', progress: 10 } } },
    { ts: 2, event: { type: 'job.progress', payload: { jobId: 'b', progress: 20 } } },
    {
      ts: 3,
      event: {
        type: 'document.created',
        payload: { jobId: 'c', documentId: 'd1', status: 'raw', title: 'Doc' },
      },
    },
    {
      ts: 4,
      event: { type: 'inbox.item_added', payload: { itemId: 'i1', itemType: 'x', title: 't' } },
    },
  ];

  it('returns the input unchanged when no filter is given', () => {
    expect(filterEvents(events)).toBe(events);
    expect(filterEvents(events, {})).toBe(events);
  });

  it('filters by jobId only', () => {
    const out = filterEvents(events, { jobId: 'a' });
    expect(out).toHaveLength(1);
    expect(out[0]?.ts).toBe(1);
  });

  it('filters by event types', () => {
    const out = filterEvents(events, { types: ['inbox.item_added'] });
    expect(out).toHaveLength(1);
    expect(out[0]?.event.type).toBe('inbox.item_added');
  });

  it('combines jobId and types (AND semantics)', () => {
    const out = filterEvents(events, { jobId: 'b', types: ['job.progress'] });
    expect(out).toHaveLength(1);
    expect(out[0]?.ts).toBe(2);

    const empty = filterEvents(events, { jobId: 'b', types: ['inbox.item_added'] });
    expect(empty).toHaveLength(0);
  });
});
