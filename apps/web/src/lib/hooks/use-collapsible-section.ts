'use client';

import { useCallback, useEffect, useState } from 'react';

import { usePrincipalOrNull } from '@/lib/auth/principal-context';

/**
 * Per-section open/closed state for the /admin/system page, persisted
 * to localStorage so each block remembers its collapse state across
 * refreshes. ALL blocks default to closed — a fresh visit doesn't dump
 * a 12-section wall on the user; one click opens what they need.
 *
 * The hook ALWAYS returns `false` on the initial render (SSR-safe);
 * the persisted value is hydrated in `useEffect`. A flicker on first
 * paint is acceptable here because the page is admin-only.
 *
 * Storage key is scoped per-user via PrincipalContext so a shared
 * workstation doesn't leak one operator's open/closed state to the
 * next. Outside the (app) tree (e.g. Setup Wizard) the principal is
 * unknown — the hook falls back to an `anon` namespace.
 */
export function useCollapsibleSection(key: string): [boolean, () => void] {
  const principal = usePrincipalOrNull();
  const userKey = principal?.id ?? 'anon';
  const storageKey = `mnela:admin-system:open:${key}:u:${userKey}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(window.localStorage.getItem(storageKey) === '1');
  }, [storageKey]);
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      }
      return next;
    });
  }, [storageKey]);
  return [open, toggle];
}
