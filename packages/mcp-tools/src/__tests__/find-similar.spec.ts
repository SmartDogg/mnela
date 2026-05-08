import { describe, expect, it } from 'vitest';

import { findSimilar } from '../tools/find-similar.js';
import { buildMockCtx } from './helpers.js';

describe('findSimilar', () => {
  it('returns hits respecting limit and excluding the source document', async () => {
    const bag = buildMockCtx();
    bag.similar.push(
      { documentId: 'd1', title: 'A', score: 0.9, snippet: 'a-snippet' },
      { documentId: 'd2', title: 'B', score: 0.8 },
      { documentId: 'd3', title: 'C', score: 0.7 },
    );

    const out = await findSimilar({ text: 'q', limit: 2, excludeDocumentId: 'd1' }, bag.ctx);
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0]?.id).toBe('d2');
  });

  it('defaults to 10 results when limit not provided', async () => {
    const bag = buildMockCtx();
    for (let i = 0; i < 15; i += 1) {
      bag.similar.push({ documentId: `d${i}`, title: `t${i}`, score: 1 - i * 0.05 });
    }
    const out = await findSimilar({ text: 'q' }, bag.ctx);
    expect(out.documents).toHaveLength(10);
  });
});
