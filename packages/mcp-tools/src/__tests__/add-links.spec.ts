import { describe, expect, it } from 'vitest';

import { addLinks } from '../tools/add-links.js';
import { buildMockCtx, seedEntity } from './helpers.js';

describe('addLinks', () => {
  it('auto-confirms a high-confidence link and emits graph.edge_added', async () => {
    const a = seedEntity('React', 'technology');
    const b = seedEntity('Vite', 'technology');
    const bag = buildMockCtx({ entities: [a, b] });

    const out = await addLinks(
      {
        links: [
          {
            fromEntity: { name: 'React', type: 'technology' },
            toEntity: { name: 'Vite', type: 'technology' },
            relationType: 'works_with',
            confidence: 0.95,
          },
        ],
      },
      bag.ctx,
    );
    expect(out.added).toHaveLength(1);
    expect(out.added[0]?.status).toBe('auto_confirmed');
    expect(out.queuedForReview).toHaveLength(0);
    expect(bag.events.filter((e) => e.kind === 'graph.edge_added')).toHaveLength(1);
    expect(bag.events.filter((e) => e.kind === 'inbox.item_added')).toHaveLength(0);
  });

  it('queues mid-confidence links for review and creates an Inbox item', async () => {
    const a = seedEntity('Acme', 'organization');
    const b = seedEntity('Beta', 'organization');
    const bag = buildMockCtx({ entities: [a, b] });

    const out = await addLinks(
      {
        links: [
          {
            fromEntity: { name: 'Acme', type: 'organization' },
            toEntity: { name: 'Beta', type: 'organization' },
            relationType: 'competes_with',
            confidence: 0.7,
            evidenceDocumentId: 'docX',
          },
        ],
      },
      bag.ctx,
    );
    expect(out.queuedForReview).toHaveLength(1);
    expect(out.queuedForReview[0]?.status).toBe('needs_review');
    expect(bag.inboxItems).toHaveLength(1);
    expect(bag.inboxItems[0]?.type).toBe('link_suggestion');
    expect(bag.events.filter((e) => e.kind === 'inbox.item_added')).toHaveLength(1);
    expect(bag.events.filter((e) => e.kind === 'graph.edge_added')).toHaveLength(1);
  });

  it('drops low-confidence links without writing anything', async () => {
    const a = seedEntity('Foo', 'concept');
    const b = seedEntity('Bar', 'concept');
    const bag = buildMockCtx({ entities: [a, b] });

    const out = await addLinks(
      {
        links: [
          {
            fromEntity: { name: 'Foo', type: 'concept' },
            toEntity: { name: 'Bar', type: 'concept' },
            relationType: 'related_to',
            confidence: 0.4,
          },
        ],
      },
      bag.ctx,
    );
    expect(out.dropped).toBe(1);
    expect(bag.edges).toHaveLength(0);
    expect(bag.inboxItems).toHaveLength(0);
  });

  it('reports missing entities without throwing', async () => {
    const bag = buildMockCtx();

    const out = await addLinks(
      {
        links: [
          {
            fromEntity: { name: 'Ghost', type: 'person' },
            toEntity: { name: 'Phantom', type: 'person' },
            relationType: 'knows',
            confidence: 0.9,
          },
        ],
      },
      bag.ctx,
    );
    expect(out.missingEntities).toHaveLength(1);
    expect(out.added).toHaveLength(0);
    expect(out.queuedForReview).toHaveLength(0);
  });
});
