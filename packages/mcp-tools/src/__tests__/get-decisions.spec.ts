import { describe, expect, it } from 'vitest';

import { getDecisions } from '../tools/get-decisions.js';
import { buildMockCtx, makeProject } from './helpers.js';

describe('getDecisions', () => {
  it('returns all decisions when no filter given', async () => {
    const bag = buildMockCtx();
    bag.decisions.push(
      {
        id: 'd1',
        projectId: null,
        title: 't1',
        decision: 'go',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'd2',
        projectId: null,
        title: 't2',
        decision: 'no',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: new Date(),
        createdAt: new Date(),
      },
    );
    const out = await getDecisions({}, bag.ctx);
    expect(out.decisions).toHaveLength(2);
  });

  it('filters by project slug', async () => {
    const project = makeProject({ slug: 'foo' });
    const bag = buildMockCtx({ projects: [project] });
    bag.decisions.push(
      {
        id: 'd1',
        projectId: project.id,
        title: 't1',
        decision: 'go',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'd2',
        projectId: 'other',
        title: 't2',
        decision: 'no',
        context: null,
        consequences: null,
        status: 'active',
        supersededById: null,
        sourceDocumentId: null,
        decidedAt: new Date(),
        createdAt: new Date(),
      },
    );
    const out = await getDecisions({ projectSlug: 'foo' }, bag.ctx);
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.id).toBe('d1');
  });
});
