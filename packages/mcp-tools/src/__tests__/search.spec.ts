import { describe, expect, it } from 'vitest';

import { search } from '../tools/search.js';
import { buildMockCtx } from './helpers.js';

describe('search', () => {
  it('routes through hybrid adapter and returns hits + total', async () => {
    const bag = buildMockCtx({
      searchResults: {
        mode: 'hybrid',
        hits: [
          { documentId: 'd1', title: 'A', snippet: 'sn', score: 0.9 },
          { documentId: 'd2', title: 'B', score: 0.7 },
        ],
        total: 2,
        page: 1,
        limit: 20,
      },
    });
    const out = await search({ query: 'react' }, bag.ctx);
    expect(out.totalCount).toBe(2);
    expect(out.documents).toHaveLength(2);
    expect(out.documents[0]).toEqual({ id: 'd1', title: 'A', score: 0.9, snippet: 'sn' });
  });

  it('narrows multi-value filters to first value (MVP)', async () => {
    const bag = buildMockCtx();
    await search(
      {
        query: 'q',
        filters: { projects: ['proj-a', 'proj-b'], types: ['note', 'memo'] },
      },
      bag.ctx,
    );
    const calls = (bag.ctx.search.search as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const [args] = calls[0] as [{ filters?: { projectSlug?: string; type?: string } }];
    expect(args.filters?.projectSlug).toBe('proj-a');
    expect(args.filters?.type).toBe('note');
  });
});
