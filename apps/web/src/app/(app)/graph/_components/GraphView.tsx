'use client';

import type {
  Edge as GraphEdge,
  Entity as GraphEntity,
  MnelaGraphHandle,
  MnelaGraphLayout,
} from '@mnela/ui';
import dynamic from 'next/dynamic';
import { forwardRef, useImperativeHandle, useRef, type Ref } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

interface GraphViewProps {
  nodes: GraphEntity[];
  edges: GraphEdge[];
  layout: MnelaGraphLayout;
  onNodeClick: (entity: GraphEntity) => void;
}

interface GraphCanvasComponentProps extends GraphViewProps {
  forwardedRef: Ref<MnelaGraphHandle>;
}

// Re-export pattern: GraphCanvas is the actual MnelaGraph wrapper. We thread
// the ref via a `forwardedRef` prop because next/dynamic does not forward
// refs through its wrapper.
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
}

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  function GraphView(props, ref): JSX.Element {
    const cyRef = useRef<MnelaGraphHandle | null>(null);

    useImperativeHandle(
      ref,
      (): GraphViewHandle => ({
        centerOn: (id) => cyRef.current?.centerOn(id),
        fit: () => cyRef.current?.fit(),
      }),
      [],
    );

    return (
      <div className="relative h-full w-full" data-testid="graph-canvas">
        <GraphCanvas forwardedRef={cyRef} {...props} />
      </div>
    );
  },
);
