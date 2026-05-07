import type { Edge, LinkStatus, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateEdgeInput {
  fromId: string;
  toId: string;
  relationType: string;
  confidence?: number;
  status?: LinkStatus;
  evidenceDocumentId?: string | null;
  evidenceChunkId?: string | null;
}

export interface UpdateEdgeInput {
  relationType?: string;
  status?: LinkStatus;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
}

export interface EdgeListFilters {
  status?: LinkStatus;
  fromId?: string;
  toId?: string;
  relationType?: string;
}

export class EdgeRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateEdgeInput): Promise<Edge> {
    return this.getPrisma().edge.create({ data: input });
  }

  findById(id: string): Promise<Edge | null> {
    return this.getPrisma().edge.findUnique({ where: { id } });
  }

  async list(filters: EdgeListFilters = {}, opts: PageOptions = {}): Promise<Page<Edge>> {
    const params = paginationParams(opts);
    const where: Prisma.EdgeWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.fromId) where.fromId = filters.fromId;
    if (filters.toId) where.toId = filters.toId;
    if (filters.relationType) where.relationType = filters.relationType;
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.edge.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.edge.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  update(id: string, patch: UpdateEdgeInput): Promise<Edge> {
    return this.getPrisma().edge.update({ where: { id }, data: patch });
  }

  delete(id: string): Promise<Edge> {
    return this.getPrisma().edge.delete({ where: { id } });
  }

  /**
   * Returns nodes (entities) and edges within `depth` hops from `centerEntityId`.
   * BFS over Edge.fromId/toId. Caps results at maxNodes to keep payload sane.
   */
  async neighborhood(
    centerEntityId: string,
    depth = 1,
    maxNodes = 200,
  ): Promise<{ nodeIds: Set<string>; edges: Edge[] }> {
    const prisma = this.getPrisma();
    const visited = new Set<string>([centerEntityId]);
    const collected: Edge[] = [];
    let frontier = [centerEntityId];

    for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
      const edges = await prisma.edge.findMany({
        where: {
          OR: [{ fromId: { in: frontier } }, { toId: { in: frontier } }],
          status: { in: ['auto_confirmed', 'manual'] },
        },
        take: maxNodes,
      });
      const next: string[] = [];
      for (const edge of edges) {
        collected.push(edge);
        for (const id of [edge.fromId, edge.toId]) {
          if (!visited.has(id) && visited.size < maxNodes) {
            visited.add(id);
            next.push(id);
          }
        }
      }
      frontier = next;
    }

    return { nodeIds: visited, edges: collected };
  }
}
