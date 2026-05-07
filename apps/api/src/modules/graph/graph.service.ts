import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EdgeRepository,
  EntityRepository,
  type UpdateEntityInput,
  normalizeEntityName,
} from '@mnela/db';
import type { Edge, Entity, EntityType } from '@prisma/client';

import { PrismaService } from '../../prisma.service.js';

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

export interface CytoscapeGraph {
  center: string;
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

@Injectable()
export class GraphService {
  constructor(
    private readonly entities: EntityRepository,
    private readonly edges: EdgeRepository,
    private readonly prisma: PrismaService,
  ) {}

  async neighborhood(
    centerId: string,
    depth = 1,
    types: EntityType[] | undefined,
    maxNodes = 200,
  ): Promise<CytoscapeGraph> {
    const center = await this.entities.findById(centerId);
    if (!center) throw new NotFoundException(`Entity ${centerId} not found`);

    const { nodeIds, edges } = await this.edges.neighborhood(centerId, depth, maxNodes);
    const allEntities = await this.prisma.active().entity.findMany({
      where: {
        id: { in: Array.from(nodeIds) },
        ...(types && types.length > 0 ? { type: { in: types } } : {}),
      },
    });

    const validIds = new Set(allEntities.map((e) => e.id));
    const filteredEdges = edges.filter((e) => validIds.has(e.fromId) && validIds.has(e.toId));

    return {
      center: centerId,
      nodes: allEntities.map(toCytoscapeNode),
      edges: filteredEdges.map(toCytoscapeEdge),
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

  async mergeEntities(sourceId: string, targetId: string): Promise<Entity> {
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
    return this.entities.merge(sourceId, targetId);
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
    patch: { relationType?: string; status?: Edge['status'] },
  ): Promise<Edge> {
    const e = await this.edges.findById(id);
    if (!e) throw new NotFoundException(`Edge ${id} not found`);
    const update: Parameters<EdgeRepository['update']>[1] = { ...patch };
    if (
      patch.status === 'manual' ||
      patch.status === 'rejected' ||
      patch.status === 'auto_confirmed'
    ) {
      update.reviewedAt = new Date();
    }
    return this.edges.update(id, update);
  }

  async deleteEdge(id: string): Promise<{ id: string; deleted: true }> {
    const e = await this.edges.findById(id);
    if (!e) throw new NotFoundException(`Edge ${id} not found`);
    await this.edges.delete(id);
    return { id, deleted: true };
  }
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
