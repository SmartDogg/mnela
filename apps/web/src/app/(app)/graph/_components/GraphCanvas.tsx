'use client';

import {
  MnelaGraph,
  type Edge as GraphEdge,
  type Entity as GraphEntity,
  type MnelaGraphHandle,
  type MnelaGraphLayout,
} from '@mnela/ui';
import { forwardRef } from 'react';

interface GraphCanvasProps {
  nodes: GraphEntity[];
  edges: GraphEdge[];
  layout: MnelaGraphLayout;
  onNodeClick: (entity: GraphEntity) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
}

// Thin client-side wrapper around <MnelaGraph>. Lives in its own file so the
// page can lazy-load it via next/dynamic with ssr disabled — Cytoscape touches
// `window` at module init.
export const GraphCanvas = forwardRef<MnelaGraphHandle, GraphCanvasProps>(function GraphCanvas(
  { nodes, edges, layout, onNodeClick, onEdgeClick },
  ref,
): JSX.Element {
  return (
    <MnelaGraph
      ref={ref}
      nodes={nodes}
      edges={edges}
      layout={layout}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      miniMap
      className="h-full w-full"
    />
  );
});
