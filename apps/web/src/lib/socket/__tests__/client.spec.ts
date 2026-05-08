import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSocket {
  on: (ev: string, fn: (...args: unknown[]) => void) => FakeSocket;
  off: (ev: string, fn?: (...args: unknown[]) => void) => FakeSocket;
  onAny: (fn: (ev: string, payload: unknown) => void) => FakeSocket;
  offAny: (fn?: (ev: string, payload: unknown) => void) => FakeSocket;
  disconnect: () => void;
  __fire: (ev: string, ...args: unknown[]) => void;
  __fireAny: (ev: string, payload: unknown) => void;
  __isLive: () => boolean;
}

const ioMock = vi.fn();

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const anyHandlers = new Set<(ev: string, payload: unknown) => void>();
  let live = true;
  const sock: FakeSocket = {
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)?.add(fn);
      return sock;
    },
    off(ev, fn) {
      if (!fn) handlers.delete(ev);
      else handlers.get(ev)?.delete(fn);
      return sock;
    },
    onAny(fn) {
      anyHandlers.add(fn);
      return sock;
    },
    offAny(fn) {
      if (!fn) anyHandlers.clear();
      else anyHandlers.delete(fn);
      return sock;
    },
    disconnect() {
      live = false;
    },
    __fire(ev, ...args) {
      handlers.get(ev)?.forEach((fn) => fn(...args));
    },
    __fireAny(ev, payload) {
      anyHandlers.forEach((fn) => fn(ev, payload));
    },
    __isLive() {
      return live;
    },
  };
  return sock;
}

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

import { configureSocketManager, getRefCount, getSocket, subscribe, __testing } from '../client';
import { useLiveSocketStore } from '../store';
import type { MnelaEvent } from '../types';

beforeEach(() => {
  vi.useFakeTimers();
  ioMock.mockReset();
  ioMock.mockImplementation(() => makeFakeSocket());
  __testing.reset();
  configureSocketManager({ origin: 'http://localhost:3000', unavailableThresholdMs: 5_000 });
});

afterEach(() => {
  __testing.reset();
  vi.useRealTimers();
});

describe('socket manager refcount', () => {
  it('connects on first subscribe, disconnects on last unsubscribe', () => {
    expect(getSocket()).toBeNull();
    const off1 = subscribe(vi.fn());
    expect(getRefCount()).toBe(1);
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(getSocket()).not.toBeNull();

    const off2 = subscribe(vi.fn());
    expect(getRefCount()).toBe(2);
    expect(ioMock).toHaveBeenCalledTimes(1); // reused

    off1();
    expect(getRefCount()).toBe(1);
    expect(getSocket()).not.toBeNull();

    off2();
    expect(getRefCount()).toBe(0);
    expect(getSocket()).toBeNull();
  });

  it('passes the configured origin and namespace to io()', () => {
    configureSocketManager({
      origin: 'https://api.example.com',
      namespace: '/live',
      path: '/socket.io',
    });
    const off = subscribe(vi.fn());
    expect(ioMock).toHaveBeenCalledWith(
      'https://api.example.com/live',
      expect.objectContaining({
        withCredentials: true,
        transports: ['websocket'],
        path: '/socket.io',
      }),
    );
    off();
  });
});

describe('status transitions', () => {
  it('starts in connecting and flips to connected on the connect event', () => {
    const off = subscribe(vi.fn());
    expect(useLiveSocketStore.getState().status).toBe('connecting');

    const sock = getSocket() as unknown as FakeSocket;
    sock.__fire('connect');
    expect(useLiveSocketStore.getState().status).toBe('connected');
    off();
  });

  it('flips to unavailable after 5s without a successful connect', () => {
    const off = subscribe(vi.fn());
    expect(useLiveSocketStore.getState().status).toBe('connecting');
    vi.advanceTimersByTime(5_000);
    expect(useLiveSocketStore.getState().status).toBe('unavailable');
    off();
  });

  it('does not flip to unavailable once we have connected', () => {
    const off = subscribe(vi.fn());
    const sock = getSocket() as unknown as FakeSocket;
    sock.__fire('connect');
    vi.advanceTimersByTime(10_000);
    expect(useLiveSocketStore.getState().status).toBe('connected');
    off();
  });
});

describe('event dispatch', () => {
  it('forwards onAny events to handlers and the store, ignoring unknown event names', () => {
    const seen: MnelaEvent[] = [];
    const off = subscribe((ev) => seen.push(ev));
    const sock = getSocket() as unknown as FakeSocket;

    sock.__fireAny('job.progress', { jobId: 'j1', progress: 42 });
    sock.__fireAny('mystery.unknown', { foo: 'bar' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('job.progress');
    const events = useLiveSocketStore.getState().lastEvents;
    expect(events).toHaveLength(1);
    expect(events[0]?.event.type).toBe('job.progress');
    off();
  });

  it('isolates handler exceptions', () => {
    const calls: string[] = [];
    const offBad = subscribe(() => {
      throw new Error('boom');
    });
    const offGood = subscribe(() => {
      calls.push('good');
    });
    const sock = getSocket() as unknown as FakeSocket;
    sock.__fireAny('inbox.item_added', { itemId: 'i', itemType: 't', title: 'x' });
    expect(calls).toEqual(['good']);
    offBad();
    offGood();
  });
});
