import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './client';

describe('ApiError', () => {
  it('captures status and problem', () => {
    const e = new ApiError('Boom', 401, { title: 'Unauthorized', status: 401 });
    expect(e.status).toBe(401);
    expect(e.problem?.title).toBe('Unauthorized');
    expect(e.message).toBe('Boom');
  });
});

describe('api wrapper', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('builds URLs against /_api in browser env', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('{"id":"x"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.get('/documents', { query: { page: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/_api/documents?page=2', expect.any(Object));
  });

  it('throws ApiError on 4xx', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: 'Bad request', status: 400 }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json' },
        }),
    ) as unknown as typeof fetch;

    await expect(api.post('/decisions', { title: '' })).rejects.toBeInstanceOf(ApiError);
  });
});
