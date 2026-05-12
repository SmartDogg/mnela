'use client';

import type { Edge as GraphEdge, Entity as GraphEntity, MnelaGraphHandle } from '@mnela/ui';
import dynamic from 'next/dynamic';
import { forwardRef, useImperativeHandle, useRef, type Ref } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

interface GraphViewProps {
  nodes: GraphEntity[];
  edges: GraphEdge[];
  onNodeClick: (entity: GraphEntity) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  /** When set, the canvas highlights matching nodes (search-as-you-type). */
  highlightQuery?: string;
}

interface GraphCanvasComponentProps extends GraphViewProps {
  forwardedRef: Ref<MnelaGraphHandle>;
}

// MnelaGraph touches `window` and canvas at module init — `next/dynamic` with
// `ssr: false` keeps it out of the SSR bundle. `forwardedRef` shape is needed
// because `next/dynamic`'s wrapper doesn't forward refs natively.
const GraphCanvas = dynamic<GraphCanvasComponentProps>(
  async () => {
    const mod = await import('./GraphCanvas');
    const Inner = mod.GraphCanvas;
    function Wrapped(props: GraphCanvasComponentProps): JSX.Element {
      const { forwardedRef, ...rest } = props;
      return <Inner ref={forwardedRef} {...rest} />;
    }
    return Wrapped;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a]">
        <Skeleton className="h-32 w-32 rounded-full" />
      </div>
    ),
  },
);

export interface GraphViewHandle {
  centerOn: (id: string) => void;
  fit: () => void;
  reheat: () => void;
}

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  function GraphView(props, ref): JSX.Element {
    const cyRef = useRef<MnelaGraphHandle | null>(null);

    useImperativeHandle(
      ref,
      (): GraphViewHandle => ({
        centerOn: (id) => cyRef.current?.centerOn(id),
        fit: () => cyRef.current?.fit(),
        // `setLayout('live')` re-heats the simulation in the new renderer
        // (the argument is ignored — there is only one physics mode now).
        reheat: () => cyRef.current?.setLayout('live'),
      }),
      [],
    );

    return (
      <div className="relative h-full w-full min-w-0" data-testid="graph-canvas">
        <GraphCanvas forwardedRef={cyRef} {...props} />
      </div>
    );
  },
);
