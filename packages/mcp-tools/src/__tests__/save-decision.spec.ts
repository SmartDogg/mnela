import { describe, expect, it } from 'vitest';

import { McpInputError } from '../errors.js';
import { saveDecision } from '../tools/save-decision.js';
import { buildMockCtx, makeProject } from './helpers.js';

describe('saveDecision', () => {
  it('creates a decision pointing at the resolved project', async () => {
    const project = makeProject({ slug: 'mnela' });
    const bag = buildMockCtx({ projects: [project] });
    const out = await saveDecision({ projectSlug: 'mnela', title: 't', decision: 'd' }, bag.ctx);
    expect(out.decisionId).toBeTruthy();
    expect(bag.decisions[0]?.projectId).toBe(project.id);
  });

  it('throws McpInputError when project slug is unknown', async () => {
    const bag = buildMockCtx();
    await expect(
      saveDecision({ projectSlug: 'nope', title: 't', decision: 'd' }, bag.ctx),
    ).rejects.toBeInstanceOf(McpInputError);
  });
});
