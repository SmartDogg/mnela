import { type INestApplication } from '@nestjs/common';
import type { Edge, Entity, LinkStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../bootstrap.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'test_admin_pwd_!1';

interface GraphResponse {
  center: string;
  nodes: { data: { id: string; label: string; type: string } }[];
  edges: {
    data: {
      id: string;
      source: string;
      target: string;
      label: string;
      confidence: number;
      status: string;
    };
  }[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    returnedNodes: number;
    returnedEdges: number;
    truncated: boolean;
  };
}

let app: INestApplication;
let prisma: import('@mnela/db').PrismaService;
let cookie: string;

let center: Entity;
let projectAlpha: Entity;
let projectBeta: Entity;
let alphaTouching: Entity;
let betaTouching: Entity;
let untouching: Entity;

const ISO_2025_01_01 = '2025-01-01T00:00:00.000Z';
const ISO_2025_06_01 = '2025-06-01T00:00:00.000Z';
const ISO_2025_12_01 = '2025-12-01T00:00:00.000Z';

beforeAll(async () => {
  app = await buildTestApp();
  const { PrismaService } = await import('@mnela/db');
  prisma = app.get(PrismaService);

  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  const setCookie = login.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no set-cookie header on login response');
  cookie = raw.split(';')[0]!;
}, 240_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await prisma.client.edge.deleteMany();
  await prisma.client.documentEntity.deleteMany();
  await prisma.client.entity.deleteMany();
});

async function makeEntity(
  name: string,
  type: 'project' | 'person' | 'technology' | 'concept' = 'concept',
  normalizedName?: string,
): Promise<Entity> {
  return prisma.client.entity.create({
    data: {
      name,
      normalizedName: normalizedName ?? name.toLowerCase().replace(/\s+/g, '-'),
      type,
      aliases: [],
    },
  });
}

async function makeEdge(
  fromId: string,
  toId: string,
  relationType: string,
  confidence: number,
  validFrom: Date,
  status: LinkStatus = 'auto_confirmed',
): Promise<Edge> {
  return prisma.client.edge.create({
    data: { fromId, toId, relationType, confidence, status, validFrom },
  });
}

async function seedFilterFixture(): Promise<void> {
  center = await makeEntity('Center');
  projectAlpha = await makeEntity('Alpha', 'project', 'alpha');
  projectBeta = await makeEntity('Beta', 'project', 'beta');
  alphaTouching = await makeEntity('AlphaPeer', 'concept');
  betaTouching = await makeEntity('BetaPeer', 'concept');
  untouching = await makeEntity('Lonely', 'concept');

  // center <-> projectAlpha (mentions, 0.9, mid-2025)
  await makeEdge(center.id, projectAlpha.id, 'mentions', 0.9, new Date(ISO_2025_06_01));
  // center <-> projectBeta (mentions, 0.4, late-2025)
  await makeEdge(center.id, projectBeta.id, 'mentions', 0.4, new Date(ISO_2025_12_01));
  // projectAlpha <-> alphaTouching (related_to, 0.7, early-2025)
  await makeEdge(projectAlpha.id, alphaTouching.id, 'related_to', 0.7, new Date(ISO_2025_01_01));
  // projectBeta <-> betaTouching (related_to, 0.3, mid-2025)
  await makeEdge(projectBeta.id, betaTouching.id, 'related_to', 0.3, new Date(ISO_2025_06_01));
  // center <-> untouching (other, 1.0, mid-2025)
  await makeEdge(center.id, untouching.id, 'other', 1.0, new Date(ISO_2025_06_01));
}

async function getGraph(query: Record<string, string | string[]>): Promise<GraphResponse> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/graph')
    .query(query)
    .set('Cookie', cookie)
    .expect(200);
  return res.body as GraphResponse;
}

describe('GET /graph — response shape', () => {
  it('returns nodes + edges + stats with the new shape', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2' });
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
    expect(body).toHaveProperty('stats');
    expect(body.stats).toMatchObject({
      truncated: false,
    });
    expect(typeof body.stats.totalNodes).toBe('number');
    expect(typeof body.stats.totalEdges).toBe('number');
    expect(typeof body.stats.returnedNodes).toBe('number');
    expect(typeof body.stats.returnedEdges).toBe('number');
    expect(body.stats.returnedNodes).toBe(body.nodes.length);
    expect(body.stats.returnedEdges).toBe(body.edges.length);
  });
});

describe('GET /graph — projectSlug filter', () => {
  it('narrows nodes/edges to those touching the matching Project entity', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2', projectSlug: 'alpha' });
    const nodeIds = new Set(body.nodes.map((n) => n.data.id));
    expect(nodeIds.has(projectAlpha.id)).toBe(true);
    // alphaTouching is reachable through projectAlpha within depth=2 BFS, so
    // it lands in the neighborhood and survives the project-touching filter.
    expect(nodeIds.has(alphaTouching.id)).toBe(true);
    expect(nodeIds.has(projectBeta.id)).toBe(false);
    expect(nodeIds.has(betaTouching.id)).toBe(false);
    expect(nodeIds.has(untouching.id)).toBe(false);

    for (const e of body.edges) {
      const incident = e.data.source === projectAlpha.id || e.data.target === projectAlpha.id;
      expect(incident).toBe(true);
    }
  });

  it('returns an empty graph when projectSlug does not resolve to a project entity', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2', projectSlug: 'no-such-slug' });
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.stats.totalNodes).toBe(0);
    expect(body.stats.totalEdges).toBe(0);
    expect(body.stats.truncated).toBe(false);
  });
});

describe('GET /graph — relations filter', () => {
  it('keeps only edges whose relationType is in the allowlist (case-sensitive)', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2', relations: ['mentions'] });
    for (const e of body.edges) expect(e.data.label).toBe('mentions');
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('accepts multiple values', async () => {
    await seedFilterFixture();
    const body = await getGraph({
      center: center.id,
      depth: '2',
      relations: ['mentions', 'related_to'],
    });
    const labels = new Set(body.edges.map((e) => e.data.label));
    expect(labels.has('other')).toBe(false);
    for (const l of labels) expect(['mentions', 'related_to']).toContain(l);
  });

  it('is case-sensitive (no normalization)', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2', relations: ['MENTIONS'] });
    expect(body.edges).toEqual([]);
  });
});

describe('GET /graph — confidence filter', () => {
  it('keeps edges with confidence >= threshold', async () => {
    await seedFilterFixture();
    const body = await getGraph({ center: center.id, depth: '2', confidence: '0.5' });
    for (const e of body.edges) expect(e.data.confidence).toBeGreaterThanOrEqual(0.5);
    // Only mentions(0.9), related_to(0.7), other(1.0) survive — not 0.4 or 0.3.
    const confidences = body.edges.map((e) => e.data.confidence).sort();
    expect(confidences.every((c) => c >= 0.5)).toBe(true);
  });
});

describe('GET /graph — validFrom range filter', () => {
  it('keeps only edges whose validFrom falls in [from,to] inclusive', async () => {
    await seedFilterFixture();
    const body = await getGraph({
      center: center.id,
      depth: '2',
      from: '2025-05-01T00:00:00.000Z',
      to: '2025-07-01T00:00:00.000Z',
    });
    // mentions(0.9, 2025-06-01), related_to-beta(2025-06-01), other(2025-06-01) — included.
    // Excluded: related_to-alpha(2025-01-01), mentions-beta(2025-12-01).
    // validFrom is not exposed in CytoscapeEdge, so cross-check via DB.
    const ids = body.edges.map((e) => e.data.id);
    expect(ids.length).toBeGreaterThan(0);
    const dbEdges = await prisma.client.edge.findMany({ where: { id: { in: ids } } });
    const lo = new Date('2025-05-01T00:00:00.000Z').getTime();
    const hi = new Date('2025-07-01T00:00:00.000Z').getTime();
    for (const e of dbEdges) {
      expect(e.validFrom.getTime()).toBeGreaterThanOrEqual(lo);
      expect(e.validFrom.getTime()).toBeLessThanOrEqual(hi);
    }
  });
});

describe('GET /graph — hard cap and truncation', () => {
  it('truncates to 500 nodes when more are reachable, sets stats.truncated=true', async () => {
    const hub = await makeEntity('Hub');
    // Seed 501 leaves connected to the hub via depth=1 — exceeds GRAPH_MAX_NODES=500.
    const leafCount = 501;
    const leaves: Entity[] = [];
    for (let i = 0; i < leafCount; i++) {
      leaves.push(await makeEntity(`leaf-${i}`));
    }
    // Bulk-create edges to keep the seed reasonably fast.
    await prisma.client.edge.createMany({
      data: leaves.map((leaf) => ({
        fromId: hub.id,
        toId: leaf.id,
        relationType: 'related_to',
        confidence: 1,
      })),
    });

    const body = await getGraph({ center: hub.id, depth: '1' });
    expect(body.stats.truncated).toBe(true);
    expect(body.nodes.length).toBe(500);
    expect(body.stats.returnedNodes).toBe(500);
    // The dropped node id must not appear in any returned edge.
    const nodeIds = new Set(body.nodes.map((n) => n.data.id));
    for (const e of body.edges) {
      expect(nodeIds.has(e.data.source)).toBe(true);
      expect(nodeIds.has(e.data.target)).toBe(true);
    }
  }, 120_000);
});
