import { describe, expect, it } from 'vitest';

import { getProjectContext } from '../tools/get-project-context.js';
import { buildMockCtx, makeProject, seedEntity } from './helpers.js';

describe('getProjectContext', () => {
  it('returns project, decisions, and openQuestions parsed from metadata', async () => {
    const project = makeProject({
      slug: 'mnela',
      name: 'Mnela',
      metadata: { openQuestions: ['why?', 'when?'] },
    });
    const bag = buildMockCtx({ projects: [project] });
    bag.decisions.push({
      id: 'd1',
      projectId: project.id,
      title: 'pick db',
      decision: 'postgres',
      context: null,
      consequences: null,
      status: 'active',
      supersededById: null,
      sourceDocumentId: null,
      decidedAt: new Date(),
      createdAt: new Date(),
    });
    const out = await getProjectContext({ slug: 'mnela' }, bag.ctx);
    expect(out.project.slug).toBe('mnela');
    expect(out.decisions).toHaveLength(1);
    expect(out.openQuestions).toEqual(['why?', 'when?']);
    expect(out.entities).toEqual([]);
  });

  it('returns aggregated entities surfaced by the project (Phase 7)', async () => {
    const project = makeProject({ slug: 'mnela', name: 'Mnela' });
    const alpha = seedEntity('Alpha', 'concept');
    const beta = seedEntity('Beta', 'technology');
    const bag = buildMockCtx({ projects: [project], entities: [alpha, beta] });
    const out = await getProjectContext({ slug: 'mnela' }, bag.ctx);
    expect(out.entities.map((e) => e.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(out.entities[0]).toMatchObject({
      id: expect.any(String),
      type: expect.stringMatching(/^(concept|technology)$/),
      aliases: expect.any(Array),
    });
  });

  it('throws when the project is missing', async () => {
    const bag = buildMockCtx();
    await expect(getProjectContext({ slug: 'nope' }, bag.ctx)).rejects.toThrow(/project not found/);
  });
});
