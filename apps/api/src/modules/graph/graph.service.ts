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
