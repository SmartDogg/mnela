import type { ProblemDetails } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly problem?: ProblemDetails;

  constructor(message: string, status: number, problem?: ProblemDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

export interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildQuery(query?: ApiFetchOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

const SAME_ORIGIN_BASE =
  typeof window === 'undefined'
    ? (process.env.MNELA_API_INTERNAL_BASE ?? 'http://localhost:3000/api/v1')
    : '/_api';

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, query, ...rest } = options;
  const url = `${SAME_ORIGIN_BASE}${path}${buildQuery(query)}`;

  const init: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    ...rest,
  };

  const finalHeaders: Record<string, string> = { ...DEFAULT_HEADERS, ...(headers ?? {}) };

  if (body !== undefined) {
    if (isFormData(body)) {
      delete finalHeaders['Content-Type'];
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
    }
  }

  init.headers = finalHeaders;

  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/json') || contentType.includes('application/problem+json');
  const payload = isJson
    ? await res.json().catch(() => undefined)
    : await res.text().catch(() => undefined);

  if (!res.ok) {
    const problem = isJson && payload ? (payload as ProblemDetails) : undefined;
    const message = problem?.title ?? problem?.detail ?? `HTTP ${res.status}`;
    throw new ApiError(message, res.status, problem);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
