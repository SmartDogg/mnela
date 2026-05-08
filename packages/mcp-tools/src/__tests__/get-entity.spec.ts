import { describe, expect, it } from 'vitest';

import { getEntity } from '../tools/get-entity.js';
import { buildMockCtx, seedEntity } from './helpers.js';

describe('getEntity', () => {
  it('returns serialized entity + adjacent edges', async () => {
    const entity = seedEntity('React', 'technology');
    const bag = buildMockCtx({ entities: [entity] });
    const out = await getEntity({ name: 'React', type: 'technology' }, bag.ctx);
    expect(out).not.toBeNull();
    expect(out?.entity.name).toBe('React');
    expect(out?.edges).toEqual([]);
    expect(out?.documents).toEqual([]);
  });

  it('returns null when entity is missing', async () => {
    const bag = buildMockCtx();
    const out = await getEntity({ name: 'Unknown' }, bag.ctx);
    expect(out).toBeNull();
  });
});
