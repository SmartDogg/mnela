import { describe, expect, it } from 'vitest';

import { updateProjectContext } from '../tools/update-project-context.js';
import { buildMockCtx, makeProject } from './helpers.js';

describe('updateProjectContext', () => {
  it('updates contextMd and returns the serialized project', async () => {
    const project = makeProject({ slug: 'foo', contextMd: null });
    const bag = buildMockCtx({ projects: [project] });
    const out = await updateProjectContext({ slug: 'foo', contextMd: '# new context' }, bag.ctx);
    expect(out.project.contextMd).toBe('# new context');
  });

  it('propagates repo errors when the project is missing', async () => {
    const bag = buildMockCtx();
    await expect(updateProjectContext({ slug: 'nope', contextMd: 'x' }, bag.ctx)).rejects.toThrow();
  });
});
