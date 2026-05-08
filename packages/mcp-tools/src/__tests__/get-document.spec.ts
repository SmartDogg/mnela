import { describe, expect, it } from 'vitest';

import { getDocument } from '../tools/get-document.js';
import { buildMockCtx, makeDocument } from './helpers.js';

describe('getDocument', () => {
  it('returns document with empty chunks when none exist', async () => {
    const doc = makeDocument({ title: 'Note', rawText: 'content' });
    const bag = buildMockCtx({ documents: [doc] });
    const out = await getDocument({ id: doc.id }, bag.ctx);
    expect(out.id).toBe(doc.id);
    expect(out.title).toBe('Note');
    expect(out.chunks).toEqual([]);
  });

  it('throws when document is missing', async () => {
    const bag = buildMockCtx();
    await expect(getDocument({ id: 'nope' }, bag.ctx)).rejects.toThrow('document not found');
  });
});
