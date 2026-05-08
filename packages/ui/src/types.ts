/**
 * Domain types consumed by `<MnelaGraph>`.
 *
 * Per ADR-0024 the API ships Entity/Edge in domain shape; this package owns
 * the Cytoscape transform. We duplicate the minimal shape here rather than
 * importing from a sibling package so `@mnela/ui` stays consumable on its own.
 *
 * Synthetic Document nodes use `type: 'document'` and synthetic edges have
 * an id that begins with `syn-`; both shape-compat with their real
 * counterparts so the transform handles them uniformly.
 */

export type EntityType = 'project' | 'person' | 'technology' | 'document' | string;

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  /** Optional confidence (0..1) when carried on the node itself. */
  confidence?: number;
  /** Free-form attributes the API may attach; opaque to the transform. */
  attributes?: Record<string, unknown>;
}

export type EdgeStatus = 'auto_confirmed' | 'needs_review' | string;

export interface Edge {
  id: string;
  fromId: string;
  toId: string;
  relationType: string;
  status: EdgeStatus;
  /** 0..1, encoded as both class bucket and numeric data attribute. */
  confidence: number;
}

/** Discriminated input accepted by `toCytoscapeElement`. */
export type EntityOrEdge = Entity | Edge;
