import { forceCollide, forceLink, forceManyBody } from 'd3-force';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from 'react';

import { type Edge, type Entity } from './types.js';

// Kept in the public API for backwards compat — the new renderer is a single
// continuous physics simulation, so the only meaningful "layout" action is to
// re-heat the simulation. Consumers calling `setLayout(<anything>)` get a
// re-heat.
export type MnelaGraphLayout = 'live' | 'fcose' | 'circular' | 'grid';

export interface MnelaGraphProps {
  nodes: Entity[];
  edges: Edge[];
  layout?: MnelaGraphLayout;
  onNodeClick?: (entity: Entity) => void;
  onEdgeClick?: (edge: Edge) => void;
  onEdgeHover?: (edge: Edge | null) => void;
  className?: string;
  miniMap?: boolean;
  /**
   * When set, nodes whose `name` contains this substring (case-insensitive)
   * are highlighted as if hovered, with everything else dimmed. Empty/undefined
   * means "no search active". Lets the page wire a search input straight into
   * the canvas without going through the imperative ref.
   */
  highlightQuery?: string;
}

export interface MnelaGraphHandle {
  appendNodes: (items: Entity[]) => void;
  appendEdges: (items: Edge[]) => void;
  setLayout: (name: MnelaGraphLayout) => void;
  centerOn: (id: string) => void;
  fit: () => void;
  /** Underlying force-graph instance; null until mount. Escape hatch. */
  getCytoscape: () => null;
}

// ─── Visual system ──────────────────────────────────────────────────────────

interface TypePalette {
  /** Solid hex used for the inner core gradient. */
  base: string;
  /** Outer hex (typically lighter sibling) used for the glow's edge stop. */
  glow: string;
  /** Hex used for the 1px ring around the node. */
  ring: string;
}

const TYPE_PALETTE: Record<string, TypePalette> = {
  project: { base: '#8b5cf6', glow: '#c4b5fd', ring: '#ddd6fe' },
  person: { base: '#10b981', glow: '#6ee7b7', ring: '#a7f3d0' },
  organization: { base: '#0ea5e9', glow: '#7dd3fc', ring: '#bae6fd' },
  technology: { base: '#f97316', glow: '#fdba74', ring: '#fed7aa' },
  concept: { base: '#eab308', glow: '#fde047', ring: '#fef08a' },
  product: { base: '#ec4899', glow: '#f9a8d4', ring: '#fbcfe8' },
  service: { base: '#14b8a6', glow: '#5eead4', ring: '#99f6e4' },
  bug: { base: '#ef4444', glow: '#fca5a5', ring: '#fecaca' },
  feature: { base: '#3b82f6', glow: '#93c5fd', ring: '#bfdbfe' },
  document: { base: '#64748b', glow: '#cbd5e1', ring: '#e2e8f0' },
  custom: { base: '#71717a', glow: '#d4d4d8', ring: '#e4e4e7' },
};

const DEFAULT_PALETTE: TypePalette = {
  base: '#71717a',
  glow: '#d4d4d8',
  ring: '#e4e4e7',
};

function paletteFor(type: string | undefined): TypePalette {
  return TYPE_PALETTE[type ?? 'custom'] ?? DEFAULT_PALETTE;
}

// ─── Internal data model ────────────────────────────────────────────────────

interface MnelaNode extends NodeObject {
  id: string;
  name: string;
  type: string;
  degree: number;
  confidence?: number;
  synthetic: boolean;
  /** Wall-clock ms when this node first appeared in the graph — drives
   * fade-in animation. Identity is preserved across re-renders so d3-force
   * keeps the simulated position. */
  __addedAt: number;
}

interface MnelaLink {
  id: string;
  source: string | MnelaNode;
  target: string | MnelaNode;
  relationType: string;
  status: string;
  confidence: number;
  synthetic: boolean;
  /** Wall-clock ms when this link first appeared — drives pulse animation. */
  __addedAt: number;
}

/**
 * Reconcile incoming Entity/Edge props with the persistent MnelaNode /
 * MnelaLink caches. KEY PROPERTY: existing entries are mutated in place so
 * d3-force keeps the same object reference (and its simulated x/y/vx/vy)
 * across renders. New entries get stamped with `__addedAt = now` so the
 * painters can fade them in. Gone entries are evicted so removed nodes
 * actually disappear.
 *
 * This is the single biggest behavioural change vs the pre-refactor renderer:
 * before, every prop change rebuilt fresh MnelaNode objects, which made
 * d3-force treat the entire graph as new and "rebooted" the simulation —
 * which is what was making the camera jump and the layout collapse on every
 * live event.
 */
function reconcileCaches(
  nodeCache: Map<string, MnelaNode>,
  linkCache: Map<string, MnelaLink>,
  nodes: readonly Entity[],
  edges: readonly Edge[],
  now: number,
): void {
  const computedDegree = new Map<string, number>();
  for (const e of edges) {
    computedDegree.set(e.fromId, (computedDegree.get(e.fromId) ?? 0) + 1);
    computedDegree.set(e.toId, (computedDegree.get(e.toId) ?? 0) + 1);
  }

  const seenNodes = new Set<string>();
  for (const n of nodes) {
    seenNodes.add(n.id);
    const apiDegree = (n.attributes as { degree?: unknown } | undefined)?.degree;
    const degree = typeof apiDegree === 'number' ? apiDegree : (computedDegree.get(n.id) ?? 0);
    const existing = nodeCache.get(n.id);
    if (existing) {
      // Mutate in place. d3-force has a reference to this object; replacing
      // it would lose position state.
      existing.name = n.name;
      existing.type = n.type;
      existing.degree = degree;
      if (typeof n.confidence === 'number') existing.confidence = n.confidence;
      else delete existing.confidence;
    } else {
      const node: MnelaNode = {
        id: n.id,
        name: n.name,
        type: n.type,
        degree,
        synthetic: n.id.startsWith('syn-'),
        __addedAt: now,
      };
      if (typeof n.confidence === 'number') node.confidence = n.confidence;
      nodeCache.set(n.id, node);
    }
  }
  // Evict nodes that disappeared from props. Without this, removing a node
  // wouldn't actually remove it from the canvas.
  for (const id of [...nodeCache.keys()]) {
    if (!seenNodes.has(id)) nodeCache.delete(id);
  }

  const seenLinks = new Set<string>();
  for (const e of edges) {
    seenLinks.add(e.id);
    const existing = linkCache.get(e.id);
    if (existing) {
      existing.relationType = e.relationType;
      existing.status = e.status;
      existing.confidence = e.confidence;
    } else {
      linkCache.set(e.id, {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        relationType: e.relationType,
        status: e.status,
        confidence: e.confidence,
        synthetic: e.id.startsWith('syn-'),
        __addedAt: now,
      });
    }
  }
  for (const id of [...linkCache.keys()]) {
    if (!seenLinks.has(id)) linkCache.delete(id);
  }
}

// ─── Custom painters ────────────────────────────────────────────────────────
// Everything in here is purely paint-time — d3-force handles positions, our
// painters decide what each tick *looks like*.

const MIN_RADIUS = 4;
const MAX_RADIUS = 11;
function radiusFor(node: MnelaNode): number {
  // sqrt scale so a 100-degree hub doesn't dwarf a 5-degree node.
  const scaled = Math.sqrt(Math.max(node.degree, 0)) * 1.6;
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, MIN_RADIUS + scaled));
}

const LABEL_ZOOM_THRESHOLD = 0.6;
/** Duration of the fade-in for newly added nodes, in ms. */
const NODE_INTRO_MS = 800;
/** Duration of the pulse for newly added edges, in ms. */
const LINK_INTRO_MS = 1500;
/**
 * If a node/link's `__addedAt` is far in the past (e.g. from a JSON-stamped
 * neighbourhood snapshot that pre-existed), skip animation. Anything older
 * than this is treated as "existing" and paints at full opacity from the
 * first frame.
 */
const INTRO_GRACE_MS = 60_000;

function nodeIntroProgress(node: MnelaNode, now: number): number {
  const age = now - node.__addedAt;
  if (age < 0 || age > INTRO_GRACE_MS) return 1;
  if (age >= NODE_INTRO_MS) return 1;
  // Ease-out cubic — softer landing than linear, no overshoot.
  const t = age / NODE_INTRO_MS;
  return 1 - Math.pow(1 - t, 3);
}

function linkIntroProgress(link: MnelaLink, now: number): number {
  const age = now - link.__addedAt;
  if (age < 0 || age > INTRO_GRACE_MS) return 1;
  if (age >= LINK_INTRO_MS) return 1;
  return age / LINK_INTRO_MS;
}

function paintNode(
  node: MnelaNode,
  ctx: CanvasRenderingContext2D,
  scale: number,
  state: PaintState,
): void {
  if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

  const palette = paletteFor(node.type);
  const r = radiusFor(node);
  const isHover = state.hoveredId === node.id;
  const isInHighlight = state.highlightedIds === null || state.highlightedIds.has(node.id);
  const isPinned = typeof node.fx === 'number' && typeof node.fy === 'number';
  const dimAlpha = isInHighlight ? 1 : 0.08;
  const confidenceAlpha = typeof node.confidence === 'number' && node.confidence < 0.5 ? 0.6 : 1;
  // Fade newly-added nodes in over NODE_INTRO_MS so the live stream looks
  // like nodes flowing in instead of popping. Existing nodes (intro=1) are
  // unaffected. force-graph paints every tick (cooldownTime: Infinity), so
  // reading Date.now() per paint gives a smooth animation without an extra
  // rAF loop.
  const intro = nodeIntroProgress(node, Date.now());
  const overallAlpha = dimAlpha * confidenceAlpha * intro;

  // Outer soft glow halo: scales with degree, intensifies on hover. This is
  // the single visual that gives the Obsidian "field of energy" feel — a
  // radial gradient several times the node's radius, low opacity, fully
  // transparent at the edge.
  const haloR = r * (isHover ? 4.6 : 3.4);
  const haloOpacity = (isHover ? 0.6 : Math.min(0.18 + node.degree * 0.012, 0.42)) * overallAlpha;
  if (haloOpacity > 0.02) {
    const halo = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, haloR);
    halo.addColorStop(0, hexA(palette.glow, haloOpacity));
    halo.addColorStop(0.55, hexA(palette.base, haloOpacity * 0.45));
    halo.addColorStop(1, hexA(palette.base, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Inner gradient body. Two radial stops give the node a soft 3D sheen
  // without looking skeuomorphic — the Graphiti/Linear vibe.
  const body = ctx.createRadialGradient(
    node.x - r * 0.35,
    node.y - r * 0.4,
    r * 0.1,
    node.x,
    node.y,
    r,
  );
  body.addColorStop(0, hexA(palette.glow, 0.95 * overallAlpha));
  body.addColorStop(1, hexA(palette.base, 0.95 * overallAlpha));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fill();

  // 1px ring; thicker on hover/selection.
  ctx.strokeStyle = hexA(palette.ring, (isHover ? 1 : 0.75) * overallAlpha);
  ctx.lineWidth = (isHover ? 1.6 : 1.1) / scale;
  if (node.synthetic) {
    ctx.setLineDash([3 / scale, 2 / scale]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Pin glyph in the upper-right when user has dragged this node.
  if (isPinned && scale > 0.4) {
    ctx.fillStyle = hexA('#fde047', 0.9 * overallAlpha);
    ctx.beginPath();
    ctx.arc(node.x + r * 0.7, node.y - r * 0.7, 1.4 / scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Label below. Always visible on hover; revealed when zoomed in; revealed
  // for the entire highlighted neighbourhood when something is being hovered.
  // Outline gives readability against any background.
  const labelVisible =
    isHover || scale > LABEL_ZOOM_THRESHOLD || (state.highlightedIds !== null && isInHighlight);
  if (labelVisible && overallAlpha > 0.15) {
    const fontSize = Math.max(10, Math.min(13, 11)) / scale;
    ctx.font = `500 ${fontSize}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = node.name.length > 36 ? `${node.name.slice(0, 35)}…` : node.name;
    const lineY = node.y + r + 4 / scale;
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = `rgba(8,8,11,${0.92 * overallAlpha})`;
    ctx.strokeText(text, node.x, lineY);
    ctx.fillStyle = `rgba(228,228,231,${(isHover ? 1 : 0.92) * overallAlpha})`;
    ctx.fillText(text, node.x, lineY);
  }
}

function paintNodePointerArea(
  node: MnelaNode,
  paintColor: string,
  ctx: CanvasRenderingContext2D,
): void {
  // The hover/click hit-area: paint a circle slightly bigger than the visible
  // node so labels and the glow are both clickable.
  if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
  const r = radiusFor(node) * 1.4;
  ctx.fillStyle = paintColor;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintLink(
  link: MnelaLink,
  ctx: CanvasRenderingContext2D,
  scale: number,
  state: PaintState,
): void {
  const s = link.source;
  const t = link.target;
  if (typeof s !== 'object' || typeof t !== 'object') return;
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return;
  if (typeof t.x !== 'number' || typeof t.y !== 'number') return;

  const isHighlighted =
    state.highlightedIds !== null &&
    typeof (s as MnelaNode).id === 'string' &&
    typeof (t as MnelaNode).id === 'string' &&
    state.highlightedIds.has((s as MnelaNode).id) &&
    state.highlightedIds.has((t as MnelaNode).id);
  const isDimmed = state.highlightedIds !== null && !isHighlighted;
  const isUnreviewed = link.status === 'needs_review';

  // Base hairline → bright when highlighted, near-invisible when dimmed.
  let alpha: number;
  if (isHighlighted) alpha = 0.85;
  else if (isDimmed) alpha = 0.03;
  else if (link.confidence < 0.5) alpha = 0.16;
  else alpha = 0.3;

  const linkIntro = linkIntroProgress(link, Date.now());
  if (linkIntro < 1) {
    // Pulse: oscillate width + opacity over the intro window so a brand-new
    // edge briefly draws the eye, then settles to the steady-state hairline.
    const pulse = Math.sin(linkIntro * Math.PI); // 0 → 1 → 0
    alpha = Math.min(1, alpha + pulse * 0.5);
  }

  ctx.strokeStyle = isHighlighted
    ? 'rgba(244,244,245,0.9)'
    : isUnreviewed
      ? `rgba(250,204,21,${alpha})`
      : `rgba(161,161,170,${alpha})`;
  const baseWidth = isHighlighted ? 1.4 : 0.8;
  const pulseExtra = linkIntro < 1 ? Math.sin(linkIntro * Math.PI) * 1.2 : 0;
  ctx.lineWidth = (baseWidth + pulseExtra) / scale;
  if (link.synthetic || isUnreviewed) ctx.setLineDash([4 / scale, 3 / scale]);

  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexA(hex: string, a: number): string {
  // hex #rrggbb → rgba(r,g,b,a). Tolerates 3-digit shorthand defensively.
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

interface PaintState {
  hoveredId: string | null;
  highlightedIds: Set<string> | null;
}

// ─── Mini-map ────────────────────────────────────────────────────────────────

interface MiniMapProps {
  nodes: readonly MnelaNode[];
  links: readonly MnelaLink[];
  bbox: { x: [number, number]; y: [number, number] } | null;
  viewport: {
    centerX: number;
    centerY: number;
    widthInGraph: number;
    heightInGraph: number;
  } | null;
  onJump: (graphX: number, graphY: number) => void;
}

function MiniMap({ nodes, links, bbox, viewport, onJump }: MiniMapProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ width: 168, height: 112 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = size.current;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(24,24,27,0.94)');
    grad.addColorStop(1, 'rgba(9,9,11,0.97)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    if (!bbox) return;
    const bbW = Math.max(bbox.x[1] - bbox.x[0], 1);
    const bbH = Math.max(bbox.y[1] - bbox.y[0], 1);
    const pad = 8;
    const scale = Math.min((width - pad * 2) / bbW, (height - pad * 2) / bbH);
    const ox = pad - bbox.x[0] * scale;
    const oy = pad - bbox.y[0] * scale;

    ctx.strokeStyle = 'rgba(161,161,170,0.3)';
    ctx.lineWidth = 0.6;
    for (const link of links) {
      const s = link.source as MnelaNode;
      const t = link.target as MnelaNode;
      if (typeof s.x !== 'number' || typeof t.x !== 'number') continue;
      ctx.beginPath();
      ctx.moveTo(s.x * scale + ox, (s.y ?? 0) * scale + oy);
      ctx.lineTo(t.x * scale + ox, (t.y ?? 0) * scale + oy);
      ctx.stroke();
    }
    for (const node of nodes) {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
      ctx.fillStyle = paletteFor(node.type).base;
      ctx.beginPath();
      ctx.arc(node.x * scale + ox, node.y * scale + oy, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (viewport) {
      const vx = (viewport.centerX - viewport.widthInGraph / 2) * scale + ox;
      const vy = (viewport.centerY - viewport.heightInGraph / 2) * scale + oy;
      const vw = viewport.widthInGraph * scale;
      const vh = viewport.heightInGraph * scale;
      ctx.strokeStyle = 'rgba(244,114,182,0.85)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(vx, vy, vw, vh);
    }
  }, [nodes, links, bbox, viewport]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !bbox) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { width, height } = size.current;
      const pad = 8;
      const bbW = Math.max(bbox.x[1] - bbox.x[0], 1);
      const bbH = Math.max(bbox.y[1] - bbox.y[0], 1);
      const scale = Math.min((width - pad * 2) / bbW, (height - pad * 2) / bbH);
      const graphX = (px - pad) / scale + bbox.x[0];
      const graphY = (py - pad) / scale + bbox.y[0];
      onJump(graphX, graphY);
    },
    [bbox, onJump],
  );

  const style: CSSProperties = {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: size.current.width,
    height: size.current.height,
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    boxShadow: '0 12px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
    cursor: 'pointer',
    overflow: 'hidden',
  };

  return <canvas ref={canvasRef} onClick={onClick} style={style} aria-label="Graph mini-map" />;
}

// ─── Component ──────────────────────────────────────────────────────────────

function MnelaGraphInner(props: MnelaGraphProps, ref: Ref<MnelaGraphHandle>): ReactElement {
  const {
    nodes,
    edges,
    onNodeClick,
    onEdgeClick,
    onEdgeHover,
    className,
    miniMap = false,
    highlightQuery,
    // `layout` is kept on the type for backwards compat but no longer drives
    // a layout switch — there's only one physics mode now.
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<MnelaNode, MnelaLink> | undefined>(undefined);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Mini-map subscribes to ticks via this counter — the force-graph instance
  // doesn't expose a "node positions changed" observable, so we redraw the
  // mini-map every tick using this state.
  const [tickToken, setTickToken] = useState(0);

  // Persistent caches keyed by id — MnelaNode/MnelaLink object identity is
  // preserved across renders so d3-force keeps the simulated position
  // attached to each entry. New entries get `__addedAt = now` to drive the
  // fade-in/pulse painters. Append/remove paths go through the same caches:
  //   - props change          → reconcileCaches() during render
  //   - ref.appendNodes/Edges → direct cache mutation + bump
  const nodeCacheRef = useRef<Map<string, MnelaNode>>(new Map());
  const linkCacheRef = useRef<Map<string, MnelaLink>>(new Map());
  // Bumped when ref-driven append/remove mutates the cache outside the prop
  // dataflow, so the graphData useMemo below re-runs and force-graph picks
  // up the new entries.
  const [refVersion, bumpRefVersion] = useReducer((v: number) => v + 1, 0);

  // Run the reconcile inline (during render) — it's idempotent for the same
  // (nodes, edges) input. Strict-Mode double-invocation only re-stamps
  // __addedAt for entries that already exist (which is a no-op in the
  // reconcile branch). New entries are stamped exactly once at the first
  // time we see their id.
  reconcileCaches(nodeCacheRef.current, linkCacheRef.current, nodes, edges, Date.now());

  // Stable-but-fresh outer wrapper. Inner arrays come from the cache so the
  // MnelaNode/MnelaLink object identities survive between renders. d3-force
  // sees "1 new node" instead of "everything is new", so positions hold and
  // the camera doesn't jump.
  const graphData = useMemo(
    () => ({
      nodes: Array.from(nodeCacheRef.current.values()),
      links: Array.from(linkCacheRef.current.values()),
    }),
    // refVersion drives ref-API-driven changes (LiveGraphPane appending via
    // imperative handle). [nodes, edges] drives the prop-driven path.
    [nodes, edges, refVersion],
  );

  // Track nodes/links by id so callbacks can resolve back to the user's
  // domain objects (the API the consumer expects).
  const nodesByIdRef = useRef(new Map<string, Entity>());
  const edgesByIdRef = useRef(new Map<string, Edge>());
  nodesByIdRef.current = new Map(nodes.map((n) => [n.id, n]));
  edgesByIdRef.current = new Map(edges.map((e) => [e.id, e]));

  const onNodeClickRef = useRef(onNodeClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  const onEdgeHoverRef = useRef(onEdgeHover);
  onNodeClickRef.current = onNodeClick;
  onEdgeClickRef.current = onEdgeClick;
  onEdgeHoverRef.current = onEdgeHover;

  // Highlight set, in priority order:
  //   1. If the user is hovering a node → highlight it + 1-hop neighbourhood
  //   2. Else if there's an active `highlightQuery` from the search box →
  //      highlight every node whose name contains it (no neighbourhood
  //      expansion; the search is meant to pinpoint, not explore)
  //   3. Else → no highlight (everyone paints at full opacity)
  const highlightedIds = useMemo<Set<string> | null>(() => {
    if (hoveredId) {
      const ids = new Set<string>([hoveredId]);
      for (const link of graphData.links) {
        const sId = typeof link.source === 'object' ? link.source.id : (link.source as string);
        const tId = typeof link.target === 'object' ? link.target.id : (link.target as string);
        if (sId === hoveredId) ids.add(tId);
        if (tId === hoveredId) ids.add(sId);
      }
      return ids;
    }
    const q = highlightQuery?.trim().toLowerCase();
    if (q && q.length > 0) {
      const ids = new Set<string>();
      for (const node of graphData.nodes) {
        if (node.name.toLowerCase().includes(q)) ids.add(node.id);
      }
      return ids.size > 0 ? ids : null;
    }
    return null;
  }, [hoveredId, highlightQuery, graphData.links, graphData.nodes]);

  // Container size observer — force-graph needs explicit width/height props.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize({ w, h });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Configure forces once the instance exists. We override d3-force defaults
  // with values tuned for 30–500 nodes: strong-but-not-violent repulsion,
  // collide to prevent overlap, link distance that grows mildly with degree.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = forceManyBody().strength(-180).distanceMin(8).distanceMax(700);
    fg.d3Force('charge', charge);
    const linkForce = forceLink<MnelaNode, MnelaLink>()
      .id((d) => d.id)
      .distance((l) => {
        const s = l.source as MnelaNode;
        const t = l.target as MnelaNode;
        const deg = Math.max(s.degree ?? 1, t.degree ?? 1);
        return 60 + Math.min(50, Math.sqrt(deg) * 6);
      })
      .strength((l) => {
        // Weaker links between hubs so dense clusters don't collapse.
        const s = l.source as MnelaNode;
        const t = l.target as MnelaNode;
        const maxDeg = Math.max(s.degree ?? 1, t.degree ?? 1);
        return 1 / Math.max(1, Math.log2(maxDeg + 1));
      });
    fg.d3Force('link', linkForce);
    fg.d3Force(
      'collide',
      forceCollide<MnelaNode>()
        .radius((n) => radiusFor(n) + 4)
        .strength(0.85),
    );
    fg.d3ReheatSimulation();
  }, [graphData]);

  const paintState = useMemo<PaintState>(
    () => ({ hoveredId, highlightedIds }),
    [hoveredId, highlightedIds],
  );

  const handleNodeClick = useCallback((node: NodeObject<MnelaNode>) => {
    const found = nodesByIdRef.current.get(node.id);
    if (found) onNodeClickRef.current?.(found);
  }, []);

  const handleLinkClick = useCallback((link: MnelaLink) => {
    const found = edgesByIdRef.current.get(link.id);
    if (found) onEdgeClickRef.current?.(found);
  }, []);

  const handleNodeHover = useCallback((node: NodeObject<MnelaNode> | null) => {
    setHoveredId(node ? node.id : null);
  }, []);

  const handleLinkHover = useCallback((link: MnelaLink | null) => {
    if (!link) {
      onEdgeHoverRef.current?.(null);
      return;
    }
    const found = edgesByIdRef.current.get(link.id);
    if (found) onEdgeHoverRef.current?.(found);
  }, []);

  // Drag → pin (fx/fy stay set). Re-heat so the rest of the graph reflows.
  const handleNodeDragEnd = useCallback((node: NodeObject<MnelaNode>) => {
    node.fx = node.x;
    node.fy = node.y;
    fgRef.current?.d3ReheatSimulation();
  }, []);

  // Mini-map needs to redraw on every tick — but the tick callback runs
  // outside React so we batch updates via rAF to avoid render storms.
  const onEngineTick = useCallback(() => {
    if (!miniMap) return;
    setTickToken((t) => (t + 1) % 1_000_000);
  }, [miniMap]);

  // Hide the link's tooltip / cursor when the hovered link's neighbourhood
  // includes the user's hover focus.
  const showPointerCursor = useCallback(
    (obj: NodeObject<MnelaNode> | MnelaLink | undefined): boolean => {
      return Boolean(obj && 'id' in obj);
    },
    [],
  );

  useImperativeHandle(
    ref,
    (): MnelaGraphHandle => ({
      appendNodes: (items) => {
        // Imperative path for live-only consumers (LiveGraphPane) — write
        // straight into the cache instead of round-tripping through props.
        // Reuses the same caches as the prop-driven reconcile, so animation
        // + position preservation work identically across both paths.
        const cache = nodeCacheRef.current;
        const linkCache = linkCacheRef.current;
        const now = Date.now();
        let added = false;
        for (const e of items) {
          if (cache.has(e.id)) continue;
          const apiDegree = (e.attributes as { degree?: unknown } | undefined)?.degree;
          // We can't compute incoming-edge degree from just nodes; degree
          // will refresh next time the consumer calls appendEdges or the
          // prop-driven reconcile sees the edge. Start at apiDegree or 0.
          const node: MnelaNode = {
            id: e.id,
            name: e.name,
            type: e.type,
            degree: typeof apiDegree === 'number' ? apiDegree : 0,
            synthetic: e.id.startsWith('syn-'),
            __addedAt: now,
          };
          if (typeof e.confidence === 'number') node.confidence = e.confidence;
          cache.set(e.id, node);
          added = true;
        }
        if (added) {
          // Recompute degrees from existing links so newly added nodes
          // immediately size-up correctly when their first edges land.
          for (const node of cache.values()) node.degree = 0;
          for (const link of linkCache.values()) {
            const sId = typeof link.source === 'object' ? link.source.id : link.source;
            const tId = typeof link.target === 'object' ? link.target.id : link.target;
            const s = cache.get(sId);
            const t = cache.get(tId);
            if (s) s.degree += 1;
            if (t) t.degree += 1;
          }
          bumpRefVersion();
          fgRef.current?.d3ReheatSimulation();
        }
      },
      appendEdges: (items) => {
        const linkCache = linkCacheRef.current;
        const nodeCache = nodeCacheRef.current;
        const now = Date.now();
        let added = false;
        for (const e of items) {
          if (linkCache.has(e.id)) continue;
          linkCache.set(e.id, {
            id: e.id,
            source: e.fromId,
            target: e.toId,
            relationType: e.relationType,
            status: e.status,
            confidence: e.confidence,
            synthetic: e.id.startsWith('syn-'),
            __addedAt: now,
          });
          const s = nodeCache.get(e.fromId);
          const t = nodeCache.get(e.toId);
          if (s) s.degree += 1;
          if (t) t.degree += 1;
          added = true;
        }
        if (added) {
          bumpRefVersion();
          fgRef.current?.d3ReheatSimulation();
        }
      },
      setLayout: () => {
        // The new renderer has no "layout" — re-heating the simulation is the
        // closest equivalent and is what the consumer probably wanted.
        fgRef.current?.d3ReheatSimulation();
      },
      centerOn: (id) => {
        const node = nodeCacheRef.current.get(id);
        const fg = fgRef.current;
        if (!fg || !node || typeof node.x !== 'number' || typeof node.y !== 'number') return;
        fg.centerAt(node.x, node.y, 600);
        fg.zoom(Math.max(fg.zoom(), 2.4), 600);
      },
      fit: () => {
        fgRef.current?.zoomToFit(500, 60);
      },
      getCytoscape: () => null,
    }),
    [],
  );

  // ── Mini-map state ────────────────────────────────────────────────────────
  const miniMapData = useMemo(() => {
    if (!miniMap) return null;
    const fg = fgRef.current;
    if (!fg) return null;
    void tickToken; // re-evaluate each tick
    const bb = fg.getGraphBbox();
    if (!bb || !isFiniteBbox(bb)) return null;
    const zoom = fg.zoom() || 1;
    const center = fg.centerAt();
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    return {
      bbox: bb,
      viewport: {
        centerX: center.x,
        centerY: center.y,
        widthInGraph: w / zoom,
        heightInGraph: h / zoom,
      },
    };
  }, [miniMap, tickToken, size]);

  const handleMiniMapJump = useCallback((graphX: number, graphY: number) => {
    fgRef.current?.centerAt(graphX, graphY, 350);
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  // Subtle "starfield" gradient under the canvas — same recipe as before;
  // gives the dark background a soft luminance instead of flat #000.
  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: 'radial-gradient(120% 90% at 50% 38%, #15151b 0%, #0a0a0c 55%, #060608 100%)',
  };

  return (
    <div className={className} style={containerStyle} ref={containerRef}>
      {size ? (
        <ForceGraph2D<MnelaNode, MnelaLink>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          // Continuous physics: cooldownTime: Infinity keeps the engine
          // ticking forever (Obsidian drift). Tune velocity decay so it
          // doesn't twitch frantically.
          cooldownTime={Infinity}
          d3AlphaDecay={0.0228}
          d3VelocityDecay={0.4}
          warmupTicks={30}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
          enablePointerInteraction
          minZoom={0.15}
          maxZoom={6}
          showPointerCursor={showPointerCursor}
          nodeRelSize={6}
          // We replace the default circle render so force-graph never paints
          // its own nodes — we own every pixel.
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(n, ctx, scale) => paintNode(n, ctx, scale, paintState)}
          nodePointerAreaPaint={paintNodePointerArea}
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={(l, ctx, scale) => paintLink(l, ctx, scale, paintState)}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onNodeDragEnd={handleNodeDragEnd}
          onLinkClick={handleLinkClick}
          onLinkHover={handleLinkHover}
          onEngineTick={onEngineTick}
        />
      ) : null}
      {miniMap && miniMapData ? (
        <MiniMap
          nodes={graphData.nodes}
          links={graphData.links}
          bbox={miniMapData.bbox}
          viewport={miniMapData.viewport}
          onJump={handleMiniMapJump}
        />
      ) : null}
    </div>
  );
}

function isFiniteBbox(bb: { x: [number, number]; y: [number, number] } | null): boolean {
  if (!bb) return false;
  return [bb.x[0], bb.x[1], bb.y[0], bb.y[1]].every((v) => Number.isFinite(v));
}

export const MnelaGraph = forwardRef<MnelaGraphHandle, MnelaGraphProps>(MnelaGraphInner);
MnelaGraph.displayName = 'MnelaGraph';
