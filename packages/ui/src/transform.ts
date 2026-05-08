import type cytoscape from 'cytoscape';

import { type Edge, type Entity, type EntityOrEdge } from './types.js';

/** 0..1 → bucket; same thresholds as the API status policy. */
export function confidenceBucket(confidence: number): 'high' | 'mid' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'mid';
  return 'low';
}

function isEdge(input: EntityOrEdge): input is Edge {
  return (
    typeof (input as Edge).fromId === 'string' &&
    typeof (input as Edge).toId === 'string' &&
    typeof (input as Edge).relationType === 'string'
  );
}

function entityToElement(entity: Entity): cytoscape.ElementDefinition {
  const classes: string[] = [`entity-${entity.type}`];
  if (typeof entity.confidence === 'number') {
    classes.push(`confidence-${confidenceBucket(entity.confidence)}`);
  }
  // Synthetic ids start with `syn-` (ADR-0024); tag them so styles can
  // distinguish projection-only nodes from DB-backed ones.
  if (entity.id.startsWith('syn-')) classes.push('synthetic');

  return {
    group: 'nodes',
    data: {
      id: entity.id,
      label: entity.name,
      type: entity.type,
      ...(typeof entity.confidence === 'number' ? { confidence: entity.confidence } : {}),
    },
    classes,
  };
}

function edgeToElement(edge: Edge): cytoscape.ElementDefinition {
  const classes: string[] = [
    `edge-${edge.status}`,
    `confidence-${confidenceBucket(edge.confidence)}`,
    `relation-${edge.relationType}`,
  ];
  if (edge.id.startsWith('syn-')) classes.push('synthetic');

  return {
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.fromId,
      target: edge.toId,
      relationType: edge.relationType,
      status: edge.status,
      confidence: edge.confidence,
    },
    classes,
  };
}

export function toCytoscapeElement(input: EntityOrEdge): cytoscape.ElementDefinition {
  return isEdge(input) ? edgeToElement(input) : entityToElement(input);
}

export function toCytoscapeElements(input: {
  nodes: readonly Entity[];
  edges: readonly Edge[];
}): cytoscape.ElementDefinition[] {
  const out: cytoscape.ElementDefinition[] = [];
  for (const n of input.nodes) out.push(entityToElement(n));
  for (const e of input.edges) out.push(edgeToElement(e));
  return out;
}
