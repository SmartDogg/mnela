import { describe, expect, it } from 'vitest';

import { confidenceBucket, toCytoscapeElement, toCytoscapeElements } from '../transform.js';
import { type Edge, type Entity } from '../types.js';

describe('confidenceBucket', () => {
  it.each([
    [1, 'high'],
    [0.85, 'high'],
    [0.8, 'high'],
    [0.79, 'mid'],
    [0.5, 'mid'],
    [0.49, 'low'],
    [0, 'low'],
  ])('maps %s to %s', (value, bucket) => {
    expect(confidenceBucket(value)).toBe(bucket);
  });
});

describe('toCytoscapeElement — entity', () => {
  it('emits a node element with type-derived class and label', () => {
    const entity: Entity = { id: 'e1', name: 'Mnela', type: 'project', confidence: 0.92 };
    const el = toCytoscapeElement(entity);
    expect(el.group).toBe('nodes');
    expect(el.data.id).toBe('e1');
    expect((el.data as Record<string, unknown>).label).toBe('Mnela');
    expect((el.data as Record<string, unknown>).type).toBe('project');
    expect((el.data as Record<string, unknown>).confidence).toBe(0.92);
    expect(el.classes).toContain('entity-project');
    expect(el.classes).toContain('confidence-high');
  });

  it('omits confidence data attribute when not provided', () => {
    const entity: Entity = { id: 'e2', name: 'Alice', type: 'person' };
    const el = toCytoscapeElement(entity);
    expect((el.data as Record<string, unknown>).confidence).toBeUndefined();
    expect(el.classes).not.toEqual(
      expect.arrayContaining(['confidence-high', 'confidence-mid', 'confidence-low']),
    );
  });

  it('flags synthetic entities (id starts with `syn-`) and document type', () => {
    const entity: Entity = {
      id: 'syn-doc-1',
      name: 'Phantom report',
      type: 'document',
      confidence: 0.4,
    };
    const el = toCytoscapeElement(entity);
    expect(el.classes).toContain('synthetic');
    expect(el.classes).toContain('entity-document');
    expect(el.classes).toContain('confidence-low');
  });
});

describe('toCytoscapeElement — edge', () => {
  it('maps fromId/toId to source/target and assigns status class', () => {
    const edge: Edge = {
      id: 'r1',
      fromId: 'a',
      toId: 'b',
      relationType: 'mentions',
      status: 'auto_confirmed',
      confidence: 0.9,
    };
    const el = toCytoscapeElement(edge);
    expect(el.group).toBe('edges');
    expect(el.data.id).toBe('r1');
    expect((el.data as Record<string, unknown>).source).toBe('a');
    expect((el.data as Record<string, unknown>).target).toBe('b');
    expect((el.data as Record<string, unknown>).relationType).toBe('mentions');
    expect((el.data as Record<string, unknown>).status).toBe('auto_confirmed');
    expect(el.classes).toContain('edge-auto_confirmed');
    expect(el.classes).toContain('confidence-high');
    expect(el.classes).toContain('relation-mentions');
  });

  it('flags synthetic edges and dashed needs_review status', () => {
    const edge: Edge = {
      id: 'syn-x',
      fromId: 'a',
      toId: 'b',
      relationType: 'authored_by',
      status: 'needs_review',
      confidence: 0.55,
    };
    const el = toCytoscapeElement(edge);
    expect(el.classes).toContain('synthetic');
    expect(el.classes).toContain('edge-needs_review');
    expect(el.classes).toContain('confidence-mid');
  });
});

describe('toCytoscapeElements', () => {
  it('returns nodes followed by edges', () => {
    const nodes: Entity[] = [
      { id: 'a', name: 'A', type: 'project' },
      { id: 'b', name: 'B', type: 'document' },
    ];
    const edges: Edge[] = [
      {
        id: 'e',
        fromId: 'a',
        toId: 'b',
        relationType: 'has_doc',
        status: 'auto_confirmed',
        confidence: 0.8,
      },
    ];
    const out = toCytoscapeElements({ nodes, edges });
    expect(out).toHaveLength(3);
    expect(out[0]?.group).toBe('nodes');
    expect(out[1]?.group).toBe('nodes');
    expect(out[2]?.group).toBe('edges');
  });
});
