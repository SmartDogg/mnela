import { describe, expect, it } from 'vitest';

import { findTool, invokeTool, PHASE_5_TOOLS } from '../registry.js';
import { buildMockCtx } from './helpers.js';

describe('registry', () => {
  it('exposes the four Phase 5 tools', () => {
    const names = PHASE_5_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'mnela_add_entities',
      'mnela_add_links',
      'mnela_find_similar',
      'mnela_get_document',
    ]);
  });

  it('findTool returns undefined for unknown name', () => {
    expect(findTool('mnela_nope')).toBeUndefined();
  });

  it('invokeTool validates input and returns parsed output', async () => {
    const bag = buildMockCtx();
    bag.similar.push({ documentId: 'd1', title: 'A', score: 0.9 });
    const out = await invokeTool('mnela_find_similar', { text: 'q' }, bag.ctx);
    expect(out).toEqual({ documents: [{ id: 'd1', title: 'A', score: 0.9 }] });
  });

  it('invokeTool throws on bad input', async () => {
    const bag = buildMockCtx();
    await expect(invokeTool('mnela_find_similar', { text: '' }, bag.ctx)).rejects.toThrow(
      'input validation failed',
    );
  });
});
