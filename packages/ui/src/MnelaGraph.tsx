import cytoscape from 'cytoscape';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from 'react';

import { toCytoscapeElement, toCytoscapeElements } from './transform.js';
import { type Edge, type Entity } from './types.js';

export type MnelaGraphLayout = 'cose' | 'cose-bilkent' | 'circular' | 'grid';

export interface MnelaGraphProps {
  nodes: Entity[];
  edges: Edge[];
  layout?: MnelaGraphLayout;
  onNodeClick?: (entity: Entity) => void;
  onEdgeClick?: (edge: Edge) => void;
  onEdgeHover?: (edge: Edge | null) => void;
  className?: string;
  miniMap?: boolean;
}

export interface MnelaGraphHandle {
  appendNodes: (items: Entity[]) => void;
  appendEdges: (items: Edge[]) => void;
  setLayout: (name: MnelaGraphLayout) => void;
  centerOn: (id: string) => void;
  fit: () => void;
  getCytoscape: () => cytoscape.Core | null;
}

// Module-level set: cytoscape.use() is global and idempotent must be enforced
// by us — calling it twice with the same plugin throws.
const registeredPlugins = new Set<string>();

async function ensurePluginRegistered(name: 'cose-bilkent'): Promise<void> {
  if (registeredPlugins.has(name)) return;
  if (name === 'cose-bilkent') {
    const mod = (await import('cytoscape-cose-bilkent')) as unknown as {
      default?: cytoscape.Ext;
    };
    const ext: cytoscape.Ext | undefined = mod.default ?? (mod as unknown as cytoscape.Ext);
    if (typeof ext !== 'function') {
      throw new Error('cytoscape-cose-bilkent did not expose a registrable extension');
    }
    cytoscape.use(ext);
    registeredPlugins.add(name);
  }
}

function layoutOptionsFor(name: MnelaGraphLayout): cytoscape.LayoutOptions {
  switch (name) {
    case 'cose':
      return { name: 'cose', animate: true, fit: true, padding: 30 };
    case 'cose-bilkent':
      // Options object is forwarded to the plugin; cast retains the
      // discriminator while passing extension-specific fields.
      return {
        name: 'cose-bilkent',
        animate: 'end',
        fit: true,
        padding: 30,
        nodeRepulsion: 4500,
        idealEdgeLength: 80,
      } as unknown as cytoscape.LayoutOptions;
    case 'circular':
      return { name: 'circle', animate: true, fit: true, padding: 30 };
    case 'grid':
      return { name: 'grid', animate: true, fit: true, padding: 30 };
  }
}

const DEFAULT_STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': '#3f3f46',
      label: 'data(label)',
      color: '#e4e4e7',
      'font-size': 11,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'border-width': 1,
      'border-color': '#52525b',
      width: 28,
      height: 28,
      opacity: 1,
      // 300 ms style transition on `opacity` powers the fadeIn animation.
      'transition-property': 'opacity background-color border-color',
      'transition-duration': 300,
    } as cytoscape.Css.Node,
  },
  {
    selector: 'node.entity-project',
    style: { 'background-color': '#6366f1', 'border-color': '#818cf8', shape: 'round-rectangle' },
  },
  {
    selector: 'node.entity-person',
    style: { 'background-color': '#10b981', 'border-color': '#34d399', shape: 'ellipse' },
  },
  {
    selector: 'node.entity-technology',
    style: { 'background-color': '#f59e0b', 'border-color': '#fbbf24', shape: 'hexagon' },
  },
  {
    selector: 'node.entity-document',
    style: { 'background-color': '#0ea5e9', 'border-color': '#38bdf8', shape: 'rectangle' },
  },
  {
    selector: 'node.confidence-low',
    style: { opacity: 0.55 },
  },
  {
    selector: 'node.confidence-mid',
    style: { opacity: 0.8 },
  },
  {
    selector: 'node.confidence-high',
    style: { opacity: 1 },
  },
  {
    selector: 'node.synthetic',
    style: { 'border-style': 'dashed' },
  },
  {
    selector: 'node.fade-in',
    style: { opacity: 0 } as cytoscape.Css.Node,
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#52525b',
      'target-arrow-color': '#52525b',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      opacity: 0.85,
      'transition-property': 'line-color width opacity',
      'transition-duration': 300,
    } as cytoscape.Css.Edge,
  },
  {
    selector: 'edge.edge-auto_confirmed',
    style: { 'line-style': 'solid', 'line-color': '#a1a1aa', 'target-arrow-color': '#a1a1aa' },
  },
  {
    selector: 'edge.edge-needs_review',
    style: { 'line-style': 'dashed', 'line-color': '#fbbf24', 'target-arrow-color': '#fbbf24' },
  },
  {
    selector: 'edge.confidence-low',
    style: { opacity: 0.5 },
  },
  {
    selector: 'edge.pulse',
    style: {
      'line-color': '#f472b6',
      'target-arrow-color': '#f472b6',
      width: 3,
    } as cytoscape.Css.Edge,
  },
];

const FADE_IN_MS = 300;
const PULSE_MS = 1500;

function animateNodeFadeIn(cy: cytoscape.Core, id: string): void {
  const ele = cy.getElementById(id);
  if (ele.empty()) return;
  ele.addClass('fade-in');
  // Force a render frame so the transition picks up the class change.
  requestAnimationFrame(() => {
    ele.removeClass('fade-in');
  });
  window.setTimeout(() => {
    ele.removeClass('fade-in');
  }, FADE_IN_MS + 50);
}

function animateEdgePulse(cy: cytoscape.Core, id: string): void {
  const ele = cy.getElementById(id);
  if (ele.empty()) return;
  ele.addClass('pulse');
  window.setTimeout(() => {
    ele.removeClass('pulse');
  }, PULSE_MS);
}

interface MiniMapProps {
  cy: cytoscape.Core | null;
}

/**
 * Lightweight in-house mini-map: renders the bounding box of all elements at a
 * fixed scale and overlays the current viewport rectangle. Click pans the
 * main view to the corresponding model coordinates. Deliberately small —
 * we avoid pulling cytoscape-navigator (TZ §7.2 only asks for "a mini-map").
 */
function MiniMap({ cy }: MiniMapProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 160, height: 110 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cy) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    canvas.width = width;
    canvas.height = height;

    const bb = cy.elements().boundingBox({});
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, width, height);

    const bbW = Math.max(bb.w, 1);
    const bbH = Math.max(bb.h, 1);
    const pad = 6;
    const scale = Math.min((width - pad * 2) / bbW, (height - pad * 2) / bbH);
    const ox = pad - bb.x1 * scale;
    const oy = pad - bb.y1 * scale;

    ctx.fillStyle = '#a1a1aa';
    cy.nodes().forEach((n) => {
      const p = n.position();
      ctx.fillRect(p.x * scale + ox - 1, p.y * scale + oy - 1, 2, 2);
    });

    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 1;
    cy.edges().forEach((e) => {
      const s = e.source().position();
      const t = e.target().position();
      ctx.beginPath();
      ctx.moveTo(s.x * scale + ox, s.y * scale + oy);
      ctx.lineTo(t.x * scale + ox, t.y * scale + oy);
      ctx.stroke();
    });

    const ext = cy.extent();
    const vx = ext.x1 * scale + ox;
    const vy = ext.y1 * scale + oy;
    const vw = (ext.x2 - ext.x1) * scale;
    const vh = (ext.y2 - ext.y1) * scale;
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
  }, [cy]);

  useEffect(() => {
    if (!cy) return;
    draw();
    const handler = (): void => draw();
    cy.on('render pan zoom add remove position', handler);
    return () => {
      cy.off('render pan zoom add remove position', handler);
    };
  }, [cy, draw]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !cy) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const bb = cy.elements().boundingBox({});
      const { width, height } = sizeRef.current;
      const pad = 6;
      const bbW = Math.max(bb.w, 1);
      const bbH = Math.max(bb.h, 1);
      const scale = Math.min((width - pad * 2) / bbW, (height - pad * 2) / bbH);
      const modelX = (px - pad) / scale + bb.x1;
      const modelY = (py - pad) / scale + bb.y1;
      // Pan so (modelX, modelY) lands at the center of the main viewport.
      // pan = viewportCenter - modelPoint * zoom (Cytoscape's render eqn).
      const zoom = cy.zoom() || 1;
      const cyContainer = cy.container();
      if (!cyContainer) return;
      const cw = cyContainer.clientWidth;
      const ch = cyContainer.clientHeight;
      cy.pan({ x: cw / 2 - modelX * zoom, y: ch / 2 - modelY * zoom });
    },
    [cy],
  );

  const style: CSSProperties = {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: sizeRef.current.width,
    height: sizeRef.current.height,
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#18181b',
    cursor: 'pointer',
  };

  return <canvas ref={canvasRef} onClick={onClick} style={style} aria-label="Graph mini-map" />;
}

function MnelaGraphInner(props: MnelaGraphProps, ref: Ref<MnelaGraphHandle>): ReactElement {
  const {
    nodes,
    edges,
    layout = 'cose',
    onNodeClick,
    onEdgeClick,
    onEdgeHover,
    className,
    miniMap = false,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [cyReady, setCyReady] = useState<cytoscape.Core | null>(null);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const onNodeClickRef = useRef(onNodeClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  const onEdgeHoverRef = useRef(onEdgeHover);
  onNodeClickRef.current = onNodeClick;
  onEdgeClickRef.current = onEdgeClick;
  onEdgeHoverRef.current = onEdgeHover;

  const runLayout = useCallback(async (cy: cytoscape.Core, name: MnelaGraphLayout) => {
    if (name === 'cose-bilkent') {
      await ensurePluginRegistered('cose-bilkent');
    }
    cy.layout(layoutOptionsFor(name)).run();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cy = cytoscape({
      container,
      elements: toCytoscapeElements({ nodes: nodesRef.current, edges: edgesRef.current }),
      style: DEFAULT_STYLE,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.on('tap', 'node', (evt) => {
      const data = evt.target.data() as { id?: string };
      const found = nodesRef.current.find((n) => n.id === data.id);
      if (found) onNodeClickRef.current?.(found);
    });
    cy.on('tap', 'edge', (evt) => {
      const data = evt.target.data() as { id?: string };
      const found = edgesRef.current.find((e) => e.id === data.id);
      if (found) onEdgeClickRef.current?.(found);
    });
    cy.on('mouseover', 'edge', (evt) => {
      const data = evt.target.data() as { id?: string };
      const found = edgesRef.current.find((e) => e.id === data.id);
      if (found) onEdgeHoverRef.current?.(found);
    });
    cy.on('mouseout', 'edge', () => {
      onEdgeHoverRef.current?.(null);
    });

    void runLayout(cy, layout);
    setCyReady(cy);

    return () => {
      cy.destroy();
      cyRef.current = null;
      setCyReady(null);
    };
    // Mount-once: `layout` and prop updates flow through their own effects
    // below; including them here would tear down the canvas on every change.
  }, []);

  // Reconcile node/edge props with the live cytoscape instance: add new ones
  // (with animations) and remove ones the parent dropped.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const incomingNodeIds = new Set(nodes.map((n) => n.id));
    const incomingEdgeIds = new Set(edges.map((e) => e.id));

    cy.batch(() => {
      cy.nodes().forEach((n) => {
        if (!incomingNodeIds.has(n.id())) cy.remove(n);
      });
      cy.edges().forEach((e) => {
        if (!incomingEdgeIds.has(e.id())) cy.remove(e);
      });
      for (const node of nodes) {
        if (cy.getElementById(node.id).empty()) {
          cy.add(toCytoscapeElement(node));
          animateNodeFadeIn(cy, node.id);
        }
      }
      for (const edge of edges) {
        if (cy.getElementById(edge.id).empty()) {
          cy.add(toCytoscapeElement(edge));
          animateEdgePulse(cy, edge.id);
        }
      }
    });
  }, [nodes, edges]);

  // Layout switch.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    void runLayout(cy, layout);
  }, [layout, runLayout]);

  useImperativeHandle(
    ref,
    (): MnelaGraphHandle => ({
      appendNodes: (items) => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.batch(() => {
          for (const item of items) {
            if (cy.getElementById(item.id).empty()) {
              cy.add(toCytoscapeElement(item));
              animateNodeFadeIn(cy, item.id);
            }
          }
        });
      },
      appendEdges: (items) => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.batch(() => {
          for (const item of items) {
            if (cy.getElementById(item.id).empty()) {
              cy.add(toCytoscapeElement(item));
              animateEdgePulse(cy, item.id);
            }
          }
        });
      },
      setLayout: (name) => {
        const cy = cyRef.current;
        if (!cy) return;
        void runLayout(cy, name);
      },
      centerOn: (id) => {
        const cy = cyRef.current;
        if (!cy) return;
        const ele = cy.getElementById(id);
        if (!ele.empty()) cy.center(ele);
      },
      fit: () => {
        cyRef.current?.fit(undefined, 30);
      },
      getCytoscape: () => cyRef.current,
    }),
    [runLayout],
  );

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#0a0a0a',
  };

  return (
    <div className={className} style={containerStyle}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="mnela-graph-canvas"
      />
      {miniMap ? <MiniMap cy={cyReady} /> : null}
    </div>
  );
}

export const MnelaGraph = forwardRef<MnelaGraphHandle, MnelaGraphProps>(MnelaGraphInner);
MnelaGraph.displayName = 'MnelaGraph';
