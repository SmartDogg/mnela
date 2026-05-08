import { describe, expect, it } from 'vitest';

import { archiveDocument } from '../tools/archive-document.js';
import { buildMockCtx, makeDocument } from './helpers.js';

describe('archiveDocument', () => {
  it('marks a document archived and returns ok=true', async () => {
    const doc = makeDocument({ status: 'parsed' });
    const bag = buildMockCtx({ documents: [doc] });
    const out = await archiveDocument({ id: doc.id }, bag.ctx);
    expect(out.ok).toBe(true);
    const stored = bag.docs.get(doc.id);
    expect(stored?.status).toBe('archived');
    expect(stored?.archivedAt).not.toBeNull();
  });

  it('errors for unknown id', async () => {
    const bag = buildMockCtx();
    await expect(archiveDocument({ id: 'nope' }, bag.ctx)).rejects.toThrow();
  });
});
