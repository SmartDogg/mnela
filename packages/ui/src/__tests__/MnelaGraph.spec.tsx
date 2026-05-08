import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEle {
  empty: () => boolean;
  id: () => string;
  addClass: (c: string) => FakeEle;
  removeClass: (c: string) => FakeEle;
  data: () => Record<string, unknown>;
  position: () => { x: number; y: number };
  source: () => FakeEle;
  target: () => FakeEle;
}

interface FakeCy {
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  layout: ReturnType<typeof vi.fn>;
  style: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
  center: ReturnType<typeof vi.fn>;
  pan: () => { x: number; y: number };
  zoom: () => number;
  extent: () => { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  batch: (fn: () => void) => void;
  nodes: () => { forEach: (cb: (n: FakeEle) => void) => void };
  edges: () => { forEach: (cb: (e: FakeEle) => void) => void };
  elements: () => {
    boundingBox: () => { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  };
  getElementById: (id: string) => FakeEle;
}

const elementStore = new Map<string, FakeEle>();

function makeEle(id: string): FakeEle {
  const ele: FakeEle = {
    empty: () => false,
    id: () => id,
    addClass: () => ele,
    removeClass: () => ele,
    data: () => ({ id }),
    position: () => ({ x: 0, y: 0 }),
    source: () => ele,
    target: () => ele,
  };
  return ele;
}

const emptyEle: FakeEle = {
  empty: () => true,
  id: () => '',
  addClass: () => emptyEle,
  removeClass: () => emptyEle,
  data: () => ({}),
  position: () => ({ x: 0, y: 0 }),
  source: () => emptyEle,
  target: () => emptyEle,
};

const fakeCy: FakeCy = {
  add: vi.fn((def: { data?: { id?: string } } | { data?: { id?: string } }[]) => {
    const arr = Array.isArray(def) ? def : [def];
    for (const d of arr) {
      const id = d.data?.id;
      if (id) elementStore.set(id, makeEle(id));
    }
  }),
  remove: vi.fn((ele: FakeEle) => {
    elementStore.delete(ele.id());
  }),
  on: vi.fn(),
  off: vi.fn(),
  layout: vi.fn(() => ({ run: vi.fn() })),
  style: vi.fn(() => ({ fromJson: vi.fn() })),
  destroy: vi.fn(() => elementStore.clear()),
  fit: vi.fn(),
  center: vi.fn(),
  pan: () => ({ x: 0, y: 0 }),
  zoom: () => 1,
  extent: () => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 }),
  batch: (fn: () => void) => fn(),
  nodes: () => ({ forEach: (cb) => elementStore.forEach((e) => cb(e)) }),
  edges: () => ({ forEach: () => undefined }),
  elements: () => ({
    boundingBox: () => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 }),
  }),
  getElementById: (id: string) => elementStore.get(id) ?? emptyEle,
};

vi.mock('cytoscape', () => {
  const factory = vi.fn(() => fakeCy);
  // Cytoscape ships as `export = cytoscape` so the default export is the
  // function itself; expose `.use` on it as the real lib does.
  Object.assign(factory, { use: vi.fn() });
  return { default: factory };
});

import { MnelaGraph, type MnelaGraphHandle } from '../MnelaGraph.js';
import { type Edge, type Entity } from '../types.js';

const sampleNodes: Entity[] = [
  { id: 'p1', name: 'Mnela', type: 'project', confidence: 0.95 },
  { id: 'd1', name: 'Spec', type: 'document', confidence: 0.7 },
];
const sampleEdges: Edge[] = [
  {
    id: 'r1',
    fromId: 'p1',
    toId: 'd1',
    relationType: 'has_doc',
    status: 'auto_confirmed',
    confidence: 0.9,
  },
];

describe('<MnelaGraph>', () => {
  beforeEach(() => {
    elementStore.clear();
    fakeCy.add.mockClear();
    fakeCy.remove.mockClear();
    fakeCy.layout.mockClear();
    fakeCy.destroy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts in jsdom without errors', () => {
    const { container } = render(<MnelaGraph nodes={sampleNodes} edges={sampleEdges} />);
    expect(container.querySelector('[data-testid="mnela-graph-canvas"]')).not.toBeNull();
  });

  it('feeds initial nodes/edges to cytoscape on mount', () => {
    render(<MnelaGraph nodes={sampleNodes} edges={sampleEdges} />);
    // Initial elements come through the constructor — assert at least one
    // layout call happened (which means cytoscape() was invoked successfully).
    expect(fakeCy.layout).toHaveBeenCalled();
  });

  it('exposes appendNodes via ref and triggers cy.add', () => {
    const ref = createRef<MnelaGraphHandle>();
    render(<MnelaGraph ref={ref} nodes={sampleNodes} edges={sampleEdges} />);
    expect(ref.current).not.toBeNull();
    // Pre-seed so the new id is genuinely new.
    elementStore.set('p1', makeEle('p1'));
    elementStore.set('d1', makeEle('d1'));

    act(() => {
      ref.current!.appendNodes([{ id: 'p2', name: 'New', type: 'person' }]);
    });
    expect(fakeCy.add).toHaveBeenCalled();
  });

  it('appendEdges adds new edge elements', () => {
    const ref = createRef<MnelaGraphHandle>();
    render(<MnelaGraph ref={ref} nodes={sampleNodes} edges={sampleEdges} />);
    elementStore.set('p1', makeEle('p1'));
    elementStore.set('d1', makeEle('d1'));
    fakeCy.add.mockClear();

    act(() => {
      ref.current!.appendEdges([
        {
          id: 'r2',
          fromId: 'p1',
          toId: 'd1',
          relationType: 'mentions',
          status: 'needs_review',
          confidence: 0.6,
        },
      ]);
    });
    expect(fakeCy.add).toHaveBeenCalled();
  });

  it('setLayout switches the layout', () => {
    const ref = createRef<MnelaGraphHandle>();
    render(<MnelaGraph ref={ref} nodes={sampleNodes} edges={sampleEdges} />);
    fakeCy.layout.mockClear();
    act(() => {
      ref.current!.setLayout('grid');
    });
    expect(fakeCy.layout).toHaveBeenCalled();
  });

  it('renders the mini-map canvas when miniMap=true', () => {
    const { container } = render(<MnelaGraph nodes={sampleNodes} edges={sampleEdges} miniMap />);
    expect(container.querySelector('canvas[aria-label="Graph mini-map"]')).not.toBeNull();
  });
});
