import { describe, expect, it } from 'vitest';

import { getChunks } from '../tools/get-chunks.js';
import { buildMockCtx } from './helpers.js';

describe('getChunks', () => {
  it('returns chunks ordered as the repo provides them', async () => {
    const bag = buildMockCtx();
    bag.chunks.set('doc1', [
      {
        id: 'c1',
        documentId: 'doc1',
        chunkIndex: 0,
        text: 'first',
        tokenCount: 1,
        metadata: null,
      },
      {
        id: 'c2',
        documentId: 'doc1',
        chunkIndex: 1,
        text: 'second',
        tokenCount: 2,
        metadata: null,
      },
    ]);
    const out = await getChunks({ documentId: 'doc1' }, bag.ctx);
    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0]).toEqual({ id: 'c1', chunkIndex: 0, text: 'first', tokenCount: 1 });
  });

  it('returns an empty array for an unknown document', async () => {
    const bag = buildMockCtx();
    const out = await getChunks({ documentId: 'nope' }, bag.ctx);
    expect(out.chunks).toEqual([]);
  });
});
