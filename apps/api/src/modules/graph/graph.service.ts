import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EdgeRepository,
  EntityRepository,
  type MergeCounts,
  PrismaService,
  type UpdateEntityInput,
  normalizeEntityName,
} from '@mnela/db';
import { publishEvent } from '@mnela/queue';
import type { Edge, Entity, EntityType } from '@prisma/client';

import { RedisService } from '../../redis.service.js';
import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from './dto.js';

export interface MergeEntitiesResult {
  dryRun: boolean;
  counts: MergeCounts;
  entity: Entity | null;
}

export interface CytoscapeNode {
  data: {
    id: string;
    label: string;
    type: EntityType;
    description?: string;
    /** Edge degree (in+out). Present on the overview endpoint; absent on /graph. */
    degree?: number;
  };
}

export interface CytoscapeEdge {
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    confidence: number;
    status: string;
  };
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  returnedNodes: number;
  returnedEdges: number;
  truncated: boolean;
}

export interface CytoscapeGraph {
  center: string;
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
  stats: GraphStats;
}

export interface NeighborhoodOptions {
  depth?: number;
  types?: EntityType[];
  maxNodes?: number;
  projectSlug?: string;
  relations?: string[];
  confidence?: number;
  from?: Date;
  to?: Date;
}

export interface OverviewOptions {
  /** Soft cap on returned nodes; clamped to GRAPH_MAX_NODES. */
  limit?: number;
  /** Hide entities with degree < this number to suppress orphan dust. */
  minDegree?: number;
  /** Restrict the overview to specific entity types (e.g. project,person). */
  types?: EntityType[];
}

export interface FacetRow {
  /** The value (entity type or relation type). */
  value: string;
  /** How many entities/edges use that value. */
  count: number;
}

@Injectable()
export class GraphService {
  constructor(
    private readonly entities: EntityRepository,
    private readonly edges: EdgeRepository,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async neighborhood(centerId: string, options: NeighborhoodOptions = {}): Promise<CytoscapeGraph> {
    const center = await this.entities.findById(centerId);
    if (!center) throw new NotFoundException(`Entity ${centerId} not found`);

    // BFS budget: when caller omits `maxNodes`, fetch one above the hard cap so
    // truncation is detectable. When caller specifies it, honor that as a
    // narrower BFS budget. GRAPH_MAX_NODES is the response-level hard cap.
    const fetchMax =
      options.maxNodes === undefined
        ? GRAPH_MAX_NODES + 1
        : Math.min(options.maxNodes, GRAPH_MAX_NODES);

    const { nodeIds, edges } = await this.edges.neighborhood(
      centerId,
      options.depth ?? 1,
      fetchMax,
    );

    const allEntities = await this.prisma.active().entity.findMany({
      where: {
        id: { in: Array.from(nodeIds) },
        ...(options.types && options.types.length > 0 ? { type: { in: options.types } } : {}),
      },
    });

    let nodes = allEntities;
    let validIds = new Set(nodes.map((e) => e.id));
    let filteredEdges = edges.filter((e) => validIds.has(e.fromId) && validIds.has(e.toId));

    if (options.projectSlug !== undefined) {
      const project = await this.prisma.active().entity.findFirst({
        where: { type: 'project', normalizedName: options.projectSlug, mergedIntoId: null },
      });
      if (!project) {
        return emptyGraph(centerId);
      }
      // Keep only nodes touching the project (the project itself + entities
      // reachable via an edge to/from it within the already-traversed
      // neighborhood). Edges are reduced to those incident on the project.
      const projectId = project.id;
      const touchingIds = new Set<string>([projectId]);
      for (const e of filteredEdges) {
        if (e.fromId === projectId) touchingIds.add(e.toId);
        if (e.toId === projectId) touchingIds.add(e.fromId);
      }
      nodes = nodes.filter((n) => touchingIds.has(n.id));
      validIds = new Set(nodes.map((n) => n.id));
      filteredEdges = filteredEdges.filter(
        (e) =>
          (e.fromId === projectId || e.toId === projectId) &&
          validIds.has(e.fromId) &&
          validIds.has(e.toId),
      );
    }

    if (options.relations && options.relations.length > 0) {
      const allow = new Set(options.relations);
      filteredEdges = filteredEdges.filter((e) => allow.has(e.relationType));
    }

    if (options.confidence !== undefined) {
      const min = options.confidence;
      filteredEdges = filteredEdges.filter((e) => e.confidence >= min);
    }

    if (options.from !== undefined) {
      const fromTime = options.from.getTime();
      filteredEdges = filteredEdges.filter((e) => e.validFrom.getTime() >= fromTime);
    }

    if (options.to !== undefined) {
      const toTime = options.to.getTime();
      filteredEdges = filteredEdges.filter((e) => e.validFrom.getTime() <= toTime);
    }

    const totalNodes = nodes.length;
    const totalEdges = filteredEdges.length;

    let truncated = false;
    let returnedNodes = nodes;
    if (returnedNodes.length > GRAPH_MAX_NODES) {
      returnedNodes = returnedNodes.slice(0, GRAPH_MAX_NODES);
      truncated = true;
    }
    const returnedNodeIds = new Set(returnedNodes.map((n) => n.id));
    let returnedEdges = filteredEdges.filter(
      (e) => returnedNodeIds.has(e.fromId) && returnedNodeIds.has(e.toId),
    );
    if (returnedEdges.length > GRAPH_MAX_EDGES) {
      returnedEdges = returnedEdges.slice(0, GRAPH_MAX_EDGES);
      truncated = true;
    }

    return {
      center: centerId,
      nodes: returnedNodes.map(toCytoscapeNode),
      edges: returnedEdges.map(toCytoscapeEdge),
      stats: {
        totalNodes,
        totalEdges,
        returnedNodes: returnedNodes.length,
        returnedEdges: returnedEdges.length,
        truncated,
      },
    };
  }

  /**
   * Zero-state landing view for /graph: the most connected entities and the
   * edges that link them. Computes degree centrality in SQL (confirmed/manual
   * edges only) then loads the surviving entities and the induced subgraph.
   * Truncation flags use the standard GraphStats shape so the client renders
   * the same banner as a regular neighborhood query.
   */
  async overview(options: OverviewOptions = {}): Promise<CytoscapeGraph> {
    // `0` is the "unlimited" sentinel from the client: no SQL LIMIT, no
    // truncation of nodes or edges. The /graph "Density: All" preset relies
    // on this — anything else means the user gets a silently capped graph.
    const unlimited = options.limit === 0;
    const requested = options.limit ?? 80;
    const limit = unlimited ? null : Math.min(requested, GRAPH_MAX_NODES);
    const minDegree = Math.max(1, options.minDegree ?? 1);
    const typeFilter = options.types && options.types.length > 0 ? options.types : null;
    const prisma = this.prisma.active();

    // Degree per entity from active edges. The double `WHERE soft-delete` is
    // implicit via `prisma.active()` — we go to $queryRaw, so we must apply
    // the entity filter explicitly below.
    const rows = unlimited
      ? await prisma.$queryRaw<{ id: string; degree: bigint }[]>`
          SELECT e.id, COUNT(*)::bigint AS degree
          FROM "Entity" e
          JOIN (
            SELECT "fromId" AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
            UNION ALL
            SELECT "toId"   AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
          ) d ON d.entity_id = e.id
          WHERE e."mergedIntoId" IS NULL
          GROUP BY e.id
          HAVING COUNT(*) >= ${minDegree}
          ORDER BY degree DESC, e.id
        `
      : await prisma.$queryRaw<{ id: string; degree: bigint }[]>`
          SELECT e.id, COUNT(*)::bigint AS degree
          FROM "Entity" e
          JOIN (
            SELECT "fromId" AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
            UNION ALL
            SELECT "toId"   AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
          ) d ON d.entity_id = e.id
          WHERE e."mergedIntoId" IS NULL
          GROUP BY e.id
          HAVING COUNT(*) >= ${minDegree}
          ORDER BY degree DESC, e.id
          LIMIT ${limit}
        `;

    if (rows.length === 0) {
      return emptyGraph('');
    }

    const idsInDegreeOrder = rows.map((r) => r.id);
    const degreeById = new Map(rows.map((r) => [r.id, Number(r.degree)]));
    const entities = await prisma.entity.findMany({
      where: {
        id: { in: idsInDegreeOrder },
        ...(typeFilter ? { type: { in: typeFilter } } : {}),
      },
    });
    // SQL didn't filter by type; do it after to preserve degree-ordering
    // when typeFilter is null.
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const nodes = idsInDegreeOrder
      .map((id) => entityById.get(id))
      .filter((e): e is Entity => Boolean(e));

    const idSet = new Set(nodes.map((n) => n.id));
    // Induced subgraph: edges where BOTH endpoints made the cut.
    const edges = await prisma.edge.findMany({
      where: {
        status: { in: ['auto_confirmed', 'manual'] },
        fromId: { in: nodes.map((n) => n.id) },
        toId: { in: nodes.map((n) => n.id) },
      },
      // When the caller asked for unlimited, lift the edge ceiling too —
      // a half-truncated graph is worse than an honest "All".
      ...(unlimited ? {} : { take: GRAPH_MAX_EDGES + 1 }),
    });
    const filteredEdges = edges.filter((e) => idSet.has(e.fromId) && idSet.has(e.toId));

    let truncatedEdges = filteredEdges;
    let truncated = false;
    if (!unlimited && truncatedEdges.length > GRAPH_MAX_EDGES) {
      truncatedEdges = truncatedEdges.slice(0, GRAPH_MAX_EDGES);
      truncated = true;
    }

    // Total nodes available with degree ≥ minDegree (for the banner).
    const totalRow = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total FROM (
        SELECT e.id
        FROM "Entity" e
        JOIN (
          SELECT "fromId" AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
          UNION ALL
          SELECT "toId"   AS entity_id FROM "Edge" WHERE status IN ('auto_confirmed', 'manual')
        ) d ON d.entity_id = e.id
        WHERE e."mergedIntoId" IS NULL
        GROUP BY e.id
        HAVING COUNT(*) >= ${minDegree}
      ) x
    `;
    const totalNodes = Number(totalRow[0]?.total ?? nodes.length);
    if (totalNodes > nodes.length) truncated = true;

    return {
      // No single center for an overview — emit an empty string. Front-end
      // never uses `center` from the response (it tracks its own).
      center: '',
      nodes: nodes.map((e) => toOverviewNode(e, degreeById.get(e.id) ?? 0)),
      edges: truncatedEdges.map(toCytoscapeEdge),
      stats: {
        totalNodes,
        totalEdges: filteredEdges.length,
        returnedNodes: nodes.length,
        returnedEdges: truncatedEdges.length,
        truncated,
      },
    };
  }

  /**
   * Distinct entity types actually present in the DB, with usage counts.
   * Lets the filter sidebar render real choices rather than the hard-coded
   * Prisma enum — empty types disappear, popular ones surface first.
   */
  async listEntityTypeFacets(): Promise<FacetRow[]> {
    const prisma = this.prisma.active();
    const rows = await prisma.$queryRaw<{ type: string; count: bigint }[]>`
      SELECT type::text AS type, COUNT(*)::bigint AS count
      FROM "Entity"
      WHERE "mergedIntoId" IS NULL
      GROUP BY type
      ORDER BY count DESC, type ASC
    `;
    return rows.map((r) => ({ value: r.type, count: Number(r.count) }));
  }

  /**
   * Distinct relation types actually present in the DB, with usage counts.
   * Edge.relationType is a free-form string — there's no enum to enumerate,
   * so we have to ask the DB.
   */
  async listRelationTypeFacets(): Promise<FacetRow[]> {
    const prisma = this.prisma.active();
    const rows = await prisma.$queryRaw<{ relationType: string; count: bigint }[]>`
      SELECT "relationType", COUNT(*)::bigint AS count
      FROM "Edge"
      WHERE status IN ('auto_confirmed', 'manual')
      GROUP BY "relationType"
      ORDER BY count DESC, "relationType" ASC
      LIMIT 200
    `;
    return rows.map((r) => ({ value: r.relationType, count: Number(r.count) }));
  }

  listEntities(
    filters: { q?: string; type?: EntityType; includeMerged?: boolean },
    page?: number,
    limit?: number,
  ) {
    return this.entities.list(filters, { page, limit });
  }

  async findEntity(id: string): Promise<Entity> {
    const e = await this.entities.findById(id);
    if (!e) throw new NotFoundException(`Entity ${id} not found`);
    return e;
  }

  /**
   * Create a new entity manually from the graph UI. If an entity with the
   * same normalized name + type already exists, return it instead of erroring
   * — this is the same "find-or-create" semantics that the ingestion
   * pipeline uses, so the UX of clicking "+ New entity" with a name that's
   * already in the graph is "we just jumped you to it" not "you made a dupe".
   */
  async createEntity(input: {
    name: string;
    type: EntityType;
    description?: string | null;
    aliases?: string[];
  }): Promise<{ entity: Entity; reused: boolean }> {
    const normalizedName = normalizeEntityName(input.name);
    if (normalizedName.length === 0) {
      throw new BadRequestException('Entity name must contain non-whitespace characters');
    }
    const existing = await this.entities.findByNormalized(normalizedName, input.type);
    if (existing) return { entity: existing, reused: true };
    const created = await this.entities.create({
      name: input.name,
      normalizedName,
      type: input.type,
      description: input.description ?? null,
      aliases: input.aliases ?? [],
    });
    await publishEvent(this.redis.client, {
      type: 'graph.node_added',
      payload: { entity: { id: created.id, name: created.name, type: created.type } },
    });
    return { entity: created, reused: false };
  }

  async updateEntity(id: string, patch: UpdateEntityInput): Promise<Entity> {
    await this.findEntity(id);
    const data: UpdateEntityInput = { ...patch };
    if (patch.name && !patch.normalizedName) {
      data.normalizedName = normalizeEntityName(patch.name);
    }
    return this.entities.update(id, data);
  }

  async mergeEntities(
    sourceId: string,
    targetId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<MergeEntitiesResult> {
    if (sourceId === targetId) throw new BadRequestException('Cannot merge entity into itself');
    const [source, target] = await Promise.all([
      this.findEntity(sourceId),
      this.findEntity(targetId),
    ]);
    if (source.mergedIntoId) {
      throw new BadRequestException(
        `Entity ${sourceId} is already merged into ${source.mergedIntoId}`,
      );
    }
    if (target.mergedIntoId) {
      throw new BadRequestException(
        `Cannot merge into ${targetId}: target is already merged into ${target.mergedIntoId}`,
      );
    }

    const dryRun = options.dryRun === true;
    const result = await this.prisma.runInTx(() =>
      this.entities.merge(sourceId, targetId, { dryRun }),
    );

    if (!dryRun) {
      await Promise.all([
        publishEvent(this.redis.client, {
          type: 'graph.node_updated',
          payload: { entityId: sourceId, changes: { mergedIntoId: targetId } },
        }),
        publishEvent(this.redis.client, {
          type: 'graph.node_updated',
          payload: { entityId: targetId, changes: { merged_from: sourceId } },
        }),
      ]);
    }

    return { dryRun, counts: result.counts, entity: result.entity };
  }

  listEdges(
    filters: { fromId?: string; toId?: string; status?: Edge['status']; relationType?: string },
    page?: number,
    limit?: number,
  ) {
    return this.edges.list(filters, { page, limit });
  }

  async updateEdge(
    id: string,
    patch: { relationType?: string; status?: Edge['status']; reviewedBy?: string },
  ): Promise<Edge> {
    const e = await this.edges.findById(id);
    if (!e) throw new NotFoundException(`Edge ${id} not found`);
    const update: Parameters<EdgeRepository['update']>[1] = {};
    if (patch.relationType !== undefined) update.relationType = patch.relationType;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.reviewedBy !== undefined) update.reviewedBy = patch.reviewedBy;
    if (
      patch.status === 'manual' ||
      patch.status === 'rejected' ||
      patch.status === 'auto_confirmed'
    ) {
      update.reviewedAt = new Date();
    }
    const updated = await this.edges.update(id, update);
    const changes: { relationType?: string; status?: string; reviewedBy?: string } = {};
    if (patch.relationType !== undefined) changes.relationType = patch.relationType;
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.reviewedBy !== undefined) changes.reviewedBy = patch.reviewedBy;
    await publishEvent(this.redis.client, {
      type: 'graph.edge_updated',
      payload: { edgeId: id, changes },
    });
    return updated;
  }

  async deleteEdge(id: string): Promise<{ id: string; deleted: true }> {
    const e = await this.edges.findById(id);
    if (!e) throw new NotFoundException(`Edge ${id} not found`);
    await this.edges.delete(id);
    await publishEvent(this.redis.client, {
      type: 'graph.edge_removed',
      payload: { edgeId: id },
    });
    return { id, deleted: true };
  }
}

function emptyGraph(centerId: string): CytoscapeGraph {
  return {
    center: centerId,
    nodes: [],
    edges: [],
    stats: {
      totalNodes: 0,
      totalEdges: 0,
      returnedNodes: 0,
      returnedEdges: 0,
      truncated: false,
    },
  };
}

function toCytoscapeNode(e: Entity): CytoscapeNode {
  const data: CytoscapeNode['data'] = {
    id: e.id,
    label: e.name,
    type: e.type,
  };
  if (e.description) data.description = e.description;
  return { data };
}

function toOverviewNode(e: Entity, degree: number): CytoscapeNode {
  // Carry degree on the node so the client can size it without a second
  // pass over edges (and so the value survives if the consumer drops edges).
  const data: CytoscapeNode['data'] = {
    id: e.id,
    label: e.name,
    type: e.type,
    degree,
  };
  if (e.description) data.description = e.description;
  return { data };
}

function toCytoscapeEdge(e: Edge): CytoscapeEdge {
  return {
    data: {
      id: e.id,
      source: e.fromId,
      target: e.toId,
      label: e.relationType,
      confidence: e.confidence,
      status: e.status,
    },
  };
}
