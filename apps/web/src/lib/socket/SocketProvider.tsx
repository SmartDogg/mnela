'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import { configureSocketManager, setQueryClient } from './client';

interface SocketProviderProps {
  children: ReactNode;
  origin?: string;
}

const DEFAULT_ORIGIN = 'http://localhost:3000';

export function SocketProvider({ children, origin }: SocketProviderProps): JSX.Element {
  const queryClient = useQueryClient();
  // In the browser, derive the socket origin from `window.location` so the
  // bundle isn't tied to the build-time NEXT_PUBLIC_MNELA_API_ORIGIN. This
  // is what lets an install initially bound to an IP transparently keep
  // working after the operator adds a DNS record and starts visiting via
  // the domain — same web container, no rebuild.
  const resolvedOrigin =
    origin ??
    (typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_MNELA_API_ORIGIN ?? DEFAULT_ORIGIN));

  useEffect(() => {
    configureSocketManager({ origin: resolvedOrigin, queryClient });
    setQueryClient(queryClient);
    return () => {
      // Don't tear the socket down on remount — only when the provider really
      // unmounts (page reload). Refcounted subscribers handle their own cleanup.
      setQueryClient(null);
    };
  }, [resolvedOrigin, queryClient]);

  return <>{children}</>;
}
