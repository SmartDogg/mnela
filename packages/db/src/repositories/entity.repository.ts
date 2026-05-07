import type { Entity, EntityType, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

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
   * Merge sourceId into targetId: marks source as merged, repoints document mentions
   * and graph edges from source → target. Idempotent.
   */
  async merge(sourceId: string, targetId: string): Promise<Entity> {
    if (sourceId === targetId) {
      throw new Error('Cannot merge entity into itself');
    }
    const prisma = this.getPrisma();

    await prisma.documentEntity.updateMany({
      where: { entityId: sourceId },
      data: { entityId: targetId },
    });

    await prisma.edge.updateMany({ where: { fromId: sourceId }, data: { fromId: targetId } });
    await prisma.edge.updateMany({ where: { toId: sourceId }, data: { toId: targetId } });

    return prisma.entity.update({
      where: { id: sourceId },
      data: { mergedIntoId: targetId },
    });
  }
}
