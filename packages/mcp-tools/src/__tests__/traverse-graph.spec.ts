import type { Edge } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { traverseGraph } from '../tools/traverse-graph.js';
import { buildMockCtx, seedEntity } from './helpers.js';

function makeEdge(fromId: string, toId: string, relationType: string): Edge {
  return {
    id: `edge_${fromId}_${toId}`,
    fromId,
    toId,
    relationType,
    confidence: 1,
    status: 'auto_confirmed',
    evidenceDocumentId: null,
    evidenceChunkId: null,
    validFrom: new Date(),
    validUntil: null,
    invalidatedById: null,
    createdAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
  };
}

describe('traverseGraph', () => {
  it('returns empty graph when starting entity is missing', async () => {
    const bag = buildMockCtx();
    const out = await traverseGraph({ fromEntity: 'Unknown' }, bag.ctx);
    expect(out).toEqual({ nodes: [], edges: [] });
  });

  it('returns the BFS frontier and filters by relationType', async () => {
    const a = seedEntity('A', 'concept');
    const b = seedEntity('B', 'concept');
    const c = seedEntity('C', 'concept');
    const bag = buildMockCtx({
      entities: [a, b, c],
      edges: [makeEdge(a.id, b.id, 'works_with'), makeEdge(b.id, c.id, 'related_to')],
    });
    const out = await traverseGraph(
      { fromEntity: 'A', maxDepth: 2, relationTypes: ['works_with'] },
      bag.ctx,
    );
    expect(out.edges.map((e) => e.relationType)).toEqual(['works_with']);
    // BFS visits A and B (and C via the second hop) — at least A+B in the node set.
    expect(out.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
