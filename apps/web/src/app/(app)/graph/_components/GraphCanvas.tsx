'use client';

import {
  MnelaGraph,
  type Edge as GraphEdge,
  type Entity as GraphEntity,
  type MnelaGraphHandle,
} from '@mnela/ui';
import { forwardRef } from 'react';

interface GraphCanvasProps {
  nodes: GraphEntity[];
  edges: GraphEdge[];
  onNodeClick: (entity: GraphEntity) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  highlightQuery?: string;
}

// Thin client-side wrapper around <MnelaGraph>. Lives in its own file so the
// page can lazy-load it via next/dynamic with ssr disabled — the renderer
// touches `window` and `HTMLCanvasElement.getContext` at module init.
export const GraphCanvas = forwardRef<MnelaGraphHandle, GraphCanvasProps>(function GraphCanvas(
  { nodes, edges, onNodeClick, onEdgeClick, highlightQuery },
  ref,
): JSX.Element {
  return (
    <MnelaGraph
      ref={ref}
      nodes={nodes}
      edges={edges}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      highlightQuery={highlightQuery}
      miniMap
      className="h-full w-full"
    />
  );
});
