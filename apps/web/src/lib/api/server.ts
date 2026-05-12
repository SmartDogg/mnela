import { cookies } from 'next/headers';

import { ApiError } from './client';
import type { Principal, ProblemDetails } from './types';

// Hard-code IPv4 in the default. On Windows + Node 22 `localhost` may resolve
// to `::1` first (IPv6) while the API binds 0.0.0.0 (IPv4 only) — that combo
// gives ECONNREFUSED on every server-side fetch. Override with
// MNELA_API_INTERNAL_BASE in deployments where the API speaks IPv6.
const INTERNAL_BASE = process.env.MNELA_API_INTERNAL_BASE ?? 'http://127.0.0.1:3000/api/v1';

async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const res = await fetch(`${INTERNAL_BASE}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
      cookie: cookieHeader,
    },
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/json') || contentType.includes('application/problem+json');
  const payload = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const problem = isJson && payload ? (payload as ProblemDetails) : undefined;
    throw new ApiError(problem?.title ?? `HTTP ${res.status}`, res.status, problem);
  }

  return payload as T;
}

export async function getPrincipal(): Promise<Principal | null> {
  try {
    return await serverFetch<Principal>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const apiServer = {
  get: <T>(path: string) => serverFetch<T>(path, { method: 'GET' }),
};
