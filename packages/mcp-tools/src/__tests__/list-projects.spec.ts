import { describe, expect, it } from 'vitest';

import { listProjects } from '../tools/list-projects.js';
import { buildMockCtx, makeProject } from './helpers.js';

describe('listProjects', () => {
  it('returns projects from the repo, serialized to ISO strings', async () => {
    const bag = buildMockCtx({
      projects: [makeProject({ slug: 'a', name: 'A' }), makeProject({ slug: 'b', name: 'B' })],
    });
    const out = await listProjects({}, bag.ctx);
    expect(out.projects.map((p) => p.slug).sort()).toEqual(['a', 'b']);
    for (const p of out.projects) {
      expect(typeof p.createdAt).toBe('string');
    }
  });

  it('returns empty list when no projects exist', async () => {
    const bag = buildMockCtx();
    const out = await listProjects({}, bag.ctx);
    expect(out.projects).toEqual([]);
  });
});
