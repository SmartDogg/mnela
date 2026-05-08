import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

import { nextDelayMs } from './backoff';
import { syncCacheForEvent } from './cacheSync';
import { ALL_EVENT_TYPES, type MnelaEvent, type MnelaEventType } from './types';
import { useLiveSocketStore } from './store';

export interface SocketManagerConfig {
  origin: string;
  namespace?: string;
  path?: string;
  /**
   * Time without a successful `connect` event after the first attempt before
   * the manager flips status to `'unavailable'` (page-level code shows the
   * polling banner per ADR-0021).
   */
  unavailableThresholdMs?: number;
  queryClient?: QueryClient | null;
}

export type EventHandler = (event: MnelaEvent) => void;

interface ManagerState {
  config: SocketManagerConfig;
  socket: Socket | null;
  refCount: number;
  handlers: Set<EventHandler>;
  attempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  unavailableTimer: ReturnType<typeof setTimeout> | null;
  hasEverConnected: boolean;
  queryClient: QueryClient | null;
}

const KNOWN_EVENT_TYPES = new Set<string>(ALL_EVENT_TYPES);

const DEFAULT_CONFIG: Required<Omit<SocketManagerConfig, 'queryClient'>> = {
  origin: 'http://localhost:3000',
  namespace: '/live',
  path: '/socket.io',
  unavailableThresholdMs: 5_000,
};

let state: ManagerState = freshState({ origin: DEFAULT_CONFIG.origin });

function freshState(config: SocketManagerConfig): ManagerState {
  return {
    config,
    socket: null,
    refCount: 0,
    handlers: new Set(),
    attempt: 0,
    reconnectTimer: null,
    unavailableTimer: null,
    hasEverConnected: false,
    queryClient: config.queryClient ?? null,
  };
}

export function configureSocketManager(config: SocketManagerConfig): void {
  // Reconfiguring while live forces a clean reconnect with the new origin/qc.
  if (state.socket) {
    teardownSocket();
  }
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state.unavailableTimer) clearTimeout(state.unavailableTimer);
  state = freshState(config);
}

export function setQueryClient(qc: QueryClient | null): void {
  state.queryClient = qc;
  state.config = { ...state.config, queryClient: qc };
}

export function getSocket(): Socket | null {
  return state.socket;
}

export function getRefCount(): number {
  return state.refCount;
}

export function connect(): Socket {
  if (state.socket) return state.socket;
  const namespace = state.config.namespace ?? DEFAULT_CONFIG.namespace;
  const path = state.config.path ?? DEFAULT_CONFIG.path;
  const url = `${state.config.origin.replace(/\/$/, '')}${namespace}`;

  useLiveSocketStore.getState().setStatus('connecting');
  armUnavailableTimer();

  const socket = io(url, {
    withCredentials: true,
    transports: ['websocket'],
    path,
    autoConnect: true,
    reconnection: false,
  });

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);
  socket.onAny((eventName: string, payload: unknown) => onAnyEvent(eventName, payload));

  state.socket = socket;
  return socket;
}

export function disconnect(): void {
  teardownSocket();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.unavailableTimer) {
    clearTimeout(state.unavailableTimer);
    state.unavailableTimer = null;
  }
  state.attempt = 0;
  state.hasEverConnected = false;
  useLiveSocketStore.getState().setStatus('idle');
}

/** Refcounted subscription. First subscriber dials in, last hangs up. */
export function subscribe(handler: EventHandler): () => void {
  state.handlers.add(handler);
  state.refCount += 1;
  if (state.refCount === 1) {
    connect();
  }
  return () => {
    if (!state.handlers.delete(handler)) return;
    state.refCount = Math.max(0, state.refCount - 1);
    if (state.refCount === 0) {
      disconnect();
    }
  };
}

function teardownSocket(): void {
  const sock = state.socket;
  if (!sock) return;
  sock.off('connect', onConnect);
  sock.off('disconnect', onDisconnect);
  sock.off('connect_error', onConnectError);
  sock.offAny();
  sock.disconnect();
  state.socket = null;
}

function onConnect(): void {
  state.hasEverConnected = true;
  state.attempt = 0;
  if (state.unavailableTimer) {
    clearTimeout(state.unavailableTimer);
    state.unavailableTimer = null;
  }
  useLiveSocketStore.getState().setStatus('connected');
}

function onDisconnect(): void {
  if (!state.socket) return; // intentional teardown — disconnect() already cleared state
  useLiveSocketStore.getState().setStatus('connecting');
  scheduleReconnect();
}

function onConnectError(): void {
  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (state.refCount === 0) return;
  if (state.reconnectTimer) return;
  const delay = nextDelayMs(state.attempt);
  state.attempt += 1;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.refCount === 0) return;
    teardownSocket();
    connect();
  }, delay);
}

function armUnavailableTimer(): void {
  if (state.unavailableTimer || state.hasEverConnected) return;
  const threshold = state.config.unavailableThresholdMs ?? DEFAULT_CONFIG.unavailableThresholdMs;
  state.unavailableTimer = setTimeout(() => {
    state.unavailableTimer = null;
    if (!state.hasEverConnected) {
      useLiveSocketStore.getState().setStatus('unavailable');
    }
  }, threshold);
}

function onAnyEvent(eventName: string, payload: unknown): void {
  if (!KNOWN_EVENT_TYPES.has(eventName)) return;
  const event = { type: eventName as MnelaEventType, payload } as MnelaEvent;
  useLiveSocketStore.getState().pushEvent(event);
  if (state.queryClient) {
    syncCacheForEvent(state.queryClient, event);
  }
  for (const handler of state.handlers) {
    try {
      handler(event);
    } catch {
      // Handler exceptions are isolated; the bus must keep flowing.
    }
  }
}

// Test-only helpers. Tree-shaken in production builds since callers must
// import them by name — exposing them here keeps the public API ergonomic.
export const __testing = {
  reset(): void {
    if (state.socket) teardownSocket();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.unavailableTimer) clearTimeout(state.unavailableTimer);
    state = freshState({ origin: DEFAULT_CONFIG.origin });
    useLiveSocketStore.getState().reset();
  },
  getState(): ManagerState {
    return state;
  },
  emit(eventName: string, payload: unknown): void {
    onAnyEvent(eventName, payload);
  },
};
