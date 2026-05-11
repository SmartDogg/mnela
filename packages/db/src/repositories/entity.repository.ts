import type { Edge, Entity, EntityType, LinkStatus, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface MergeCounts {
  documentLinks: number;
  edgeRepoints: number;
  edgeDedupes: number;
  selfLoops: number;
}

export interface MergeResult {
  counts: MergeCounts;
  entity: Entity | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  type: string | null;
  createdAt: Date;
}

export interface EntityWithRelations {
  entity: Entity;
  documents: DocumentSummary[];
  edges: Edge[];
}

export interface CreateEntityInput {
  name: string;
  normalizedName: string;
  type: EntityType;
  description?: string | null;
  aliases?: string[];
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateEntityInput {
  name?: string;
  normalizedName?: string;
  description?: string | null;
  aliases?: string[];
  metadata?: Prisma.InputJsonValue;
}

export interface EntityListFilters {
  type?: EntityType;
  q?: string;
  includeMerged?: boolean;
}

export function normalizeEntityName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export class EntityRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateEntityInput): Promise<Entity> {
    return this.getPrisma().entity.create({ data: input });
  }

  findById(id: string): Promise<Entity | null> {
    return this.getPrisma().entity.findUnique({ where: { id } });
  }

  findByNormalized(normalizedName: string, type: EntityType): Promise<Entity | null> {
    return this.getPrisma().entity.findUnique({
      where: { normalizedName_type: { normalizedName, type } },
    });
  }

  async findByNameWithJoins(name: string, type?: EntityType): Promise<EntityWithRelations | null> {
    const prisma = this.getPrisma();
    const normalizedName = normalizeEntityName(name);
    const entity = await prisma.entity.findFirst({
      where: { normalizedName, mergedIntoId: null, ...(type ? { type } : {}) },
    });
    if (!entity) return null;

    const [docRows, edges] = await Promise.all([
      prisma.documentEntity.findMany({
        where: { entityId: entity.id },
        take: 50,
        orderBy: { document: { createdAt: 'desc' } },
        select: {
          document: {
            select: { id: true, title: true, type: true, createdAt: true },
          },
        },
      }),
      prisma.edge.findMany({
        where: {
          OR: [{ fromId: entity.id }, { toId: entity.id }],
          status: { in: ['auto_confirmed', 'needs_review'] },
        },
      }),
    ]);

    const documents: DocumentSummary[] = docRows.map((row) => row.document);

    return { entity, documents, edges };
  }

  async list(filters: EntityListFilters = {}, opts: PageOptions = {}): Promise<Page<Entity>> {
    const params = paginationParams(opts);
    const where: Prisma.EntityWhereInput = {};
    if (filters.type) where.type = filters.type;
    if (!filters.includeMerged) where.mergedIntoId = null;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { aliases: { has: filters.q } },
      ];
    }
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.entity.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { name: 'asc' },
      }),
      prisma.entity.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  update(id: string, patch: UpdateEntityInput): Promise<Entity> {
    return this.getPrisma().entity.update({ where: { id }, data: patch });
  }

  /**
   * Merge `sourceId` into `targetId`: repoints DocumentEntity rows + edges,
   * deletes self-loops created by the repoint, deduplicates edges that would
   * collide on `(fromId, toId, relationType)` (keeping the higher-confidence
   * row), and marks the source as merged. When `dryRun: true`, computes the
   * counts without writing anything. Caller must wrap in `runInTx` for
   * atomicity — when not in a tx, intermediate states are visible.
   */
  async merge(
    sourceId: string,
    targetId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<MergeResult> {
    if (sourceId === targetId) {
      throw new Error('Cannot merge entity into itself');
    }
    const prisma = this.getPrisma();

    const sourceEdges = await prisma.edge.findMany({
      where: { OR: [{ fromId: sourceId }, { toId: sourceId }] },
    });

    const selfLoopIds: string[] = [];
    const repointable: Edge[] = [];
    for (const e of sourceEdges) {
      const newFrom = e.fromId === sourceId ? targetId : e.fromId;
      const newTo = e.toId === sourceId ? targetId : e.toId;
      if (newFrom === newTo) selfLoopIds.push(e.id);
      else repointable.push(e);
    }

    const targetEdgeKeys = new Set<string>();
    if (repointable.length > 0) {
      const tuples = repointable.map((e) => ({
        fromId: e.fromId === sourceId ? targetId : e.fromId,
        toId: e.toId === sourceId ? targetId : e.toId,
        relationType: e.relationType,
      }));
      const candidates = await prisma.edge.findMany({
        where: {
          OR: tuples.map((t) => ({
            fromId: t.fromId,
            toId: t.toId,
            relationType: t.relationType,
            id: { notIn: repointable.map((e) => e.id) },
          })),
        },
      });
      for (const c of candidates) {
        targetEdgeKeys.add(edgeKey(c.fromId, c.toId, c.relationType));
      }
    }

    const edgesToDeleteForDedupe: string[] = [];
    const survivingTargetEdgeIds = new Map<string, string>();
    const survivingSourceEdges: Edge[] = [];

    for (const e of repointable) {
      const newFrom = e.fromId === sourceId ? targetId : e.fromId;
      const newTo = e.toId === sourceId ? targetId : e.toId;
      const key = edgeKey(newFrom, newTo, e.relationType);

      if (targetEdgeKeys.has(key)) {
        const existing = await prisma.edge.findUnique({
          where: {
            fromId_toId_relationType: {
              fromId: newFrom,
              toId: newTo,
              relationType: e.relationType,
            },
          },
        });
        if (!existing) {
          survivingSourceEdges.push(e);
          continue;
        }
        const winner = pickEdgeWinner(existing, e);
        if (winner.id === existing.id) {
          edgesToDeleteForDedupe.push(e.id);
        } else {
          edgesToDeleteForDedupe.push(existing.id);
          survivingTargetEdgeIds.set(e.id, existing.id);
          survivingSourceEdges.push(e);
        }
      } else {
        survivingSourceEdges.push(e);
      }
    }

    const documentLinks = await prisma.documentEntity.count({ where: { entityId: sourceId } });

    const counts: MergeCounts = {
      documentLinks,
      edgeRepoints: survivingSourceEdges.length,
      edgeDedupes: edgesToDeleteForDedupe.length,
      selfLoops: selfLoopIds.length,
    };

    if (options.dryRun) {
      return { counts, entity: null };
    }

    if (selfLoopIds.length > 0) {
      await prisma.edge.deleteMany({ where: { id: { in: selfLoopIds } } });
    }
    if (edgesToDeleteForDedupe.length > 0) {
      await prisma.edge.deleteMany({ where: { id: { in: edgesToDeleteForDedupe } } });
    }

    await prisma.documentEntity.updateMany({
      where: { entityId: sourceId },
      data: { entityId: targetId },
    });

    if (survivingSourceEdges.length > 0) {
      const survivorIds = survivingSourceEdges.map((e) => e.id);
      await prisma.edge.updateMany({
        where: { id: { in: survivorIds }, fromId: sourceId },
        data: { fromId: targetId },
      });
      await prisma.edge.updateMany({
        where: { id: { in: survivorIds }, toId: sourceId },
        data: { toId: targetId },
      });
    }

    const entity = await prisma.entity.update({
      where: { id: sourceId },
      data: { mergedIntoId: targetId },
    });

    return { counts, entity };
  }
}

function edgeKey(fromId: string, toId: string, relationType: string): string {
  return `${fromId}${toId}${relationType}`;
}

const STATUS_PRIORITY: Record<LinkStatus, number> = {
  auto_confirmed: 3,
  manual: 2,
  needs_review: 1,
  rejected: 0,
};

function pickEdgeWinner(a: Edge, b: Edge): Edge {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  const pa = STATUS_PRIORITY[a.status];
  const pb = STATUS_PRIORITY[b.status];
  if (pa !== pb) return pa > pb ? a : b;
  return a.id < b.id ? a : b;
}
