'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { Principal } from '@/lib/api/types';

const PrincipalContext = createContext<Principal | null>(null);

export function PrincipalProvider({
  value,
  children,
}: {
  value: Principal;
  children: ReactNode;
}): JSX.Element {
  return <PrincipalContext.Provider value={value}>{children}</PrincipalContext.Provider>;
}

export function usePrincipalOrNull(): Principal | null {
  return useContext(PrincipalContext);
}

export function usePrincipal(): Principal {
  const p = useContext(PrincipalContext);
  if (!p) {
    throw new Error('usePrincipal() called outside a PrincipalProvider');
  }
  return p;
}
