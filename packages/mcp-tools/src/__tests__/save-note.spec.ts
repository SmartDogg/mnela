import { describe, expect, it } from 'vitest';

import { saveNote } from '../tools/save-note.js';
import { buildMockCtx, makeProject } from './helpers.js';

describe('saveNote', () => {
  it('creates a Document with sha256 contentHash and default source/type', async () => {
    const bag = buildMockCtx();
    const out = await saveNote({ content: 'hello world' }, bag.ctx);
    expect(out.documentId).toBeTruthy();
    const created = bag.docs.get(out.documentId);
    expect(created?.source).toBe('manual_upload');
    expect(created?.type).toBe('note');
    expect(created?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created?.rawText).toBe('hello world');
  });

  it('attaches the document to known projects via setProjects', async () => {
    const project = makeProject({ slug: 'foo' });
    const bag = buildMockCtx({ projects: [project] });
    const out = await saveNote({ content: 'note', projects: ['foo', 'unknown'] }, bag.ctx);
    expect(out.documentId).toBeTruthy();
    const setProjects = bag.ctx.documents.setProjects as unknown as {
      mock: { calls: unknown[][] };
    };
    expect(setProjects.mock.calls).toHaveLength(1);
    const [, ids] = setProjects.mock.calls[0] as [string, string[]];
    // Unknown slugs are silently dropped.
    expect(ids).toEqual([project.id]);
  });
});
