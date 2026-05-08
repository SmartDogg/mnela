import { describe, expect, it } from 'vitest';

import { addEntities } from '../tools/add-entities.js';
import { buildMockCtx, seedEntity } from './helpers.js';

describe('addEntities', () => {
  it('creates new entities and emits graph.node_added', async () => {
    const bag = buildMockCtx();
    const out = await addEntities(
      {
        documentId: 'doc1',
        entities: [
          { name: 'React', type: 'technology', confidence: 0.95 },
          { name: 'Postgres', type: 'technology', confidence: 0.9 },
        ],
      },
      bag.ctx,
    );
    expect(out.added).toHaveLength(2);
    expect(out.merged).toHaveLength(0);
    expect(out.dropped).toBe(0);
    expect(bag.events.filter((e) => e.kind === 'graph.node_added')).toHaveLength(2);
  });

  it('reuses existing entities and reports them as merged', async () => {
    const existing = seedEntity('React', 'technology');
    const bag = buildMockCtx({ entities: [existing] });
    const out = await addEntities(
      {
        documentId: 'doc1',
        entities: [{ name: 'React', type: 'technology', confidence: 0.9 }],
      },
      bag.ctx,
    );
    expect(out.added).toHaveLength(0);
    expect(out.merged).toHaveLength(1);
    expect(out.merged[0]?.id).toBe(existing.id);
    // Reuse should NOT emit graph.node_added (the node is already on the graph).
    expect(bag.events.filter((e) => e.kind === 'graph.node_added')).toHaveLength(0);
  });

  it('drops entities with confidence < 0.5', async () => {
    const bag = buildMockCtx();
    const out = await addEntities(
      {
        documentId: 'doc1',
        entities: [
          { name: 'GoodEntity', type: 'concept', confidence: 0.6 },
          { name: 'WeakEntity', type: 'concept', confidence: 0.4 },
        ],
      },
      bag.ctx,
    );
    expect(out.added).toHaveLength(1);
    expect(out.dropped).toBe(1);
  });
});
