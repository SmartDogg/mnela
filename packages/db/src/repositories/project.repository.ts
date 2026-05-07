import type { Prisma, Project } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateProjectInput {
  slug: string;
  name: string;
  description?: string | null;
  status?: string;
  contextMd?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: string;
  contextMd?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export class ProjectRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(data: CreateProjectInput): Promise<Project> {
    return this.getPrisma().project.create({ data });
  }

  findBySlug(slug: string): Promise<Project | null> {
    return this.getPrisma().project.findUnique({ where: { slug } });
  }

  findById(id: string): Promise<Project | null> {
    return this.getPrisma().project.findUnique({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    return this.getPrisma().project.findMany({ where: { id: { in: ids } } });
  }

  async list(opts: PageOptions = {}): Promise<Page<Project>> {
    const params = paginationParams(opts);
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.project.findMany({
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.count(),
    ]);
    return makePage(items, total, params);
  }

  update(slug: string, patch: UpdateProjectInput): Promise<Project> {
    return this.getPrisma().project.update({ where: { slug }, data: patch });
  }

  delete(slug: string): Promise<Project> {
    return this.getPrisma().project.delete({ where: { slug } });
  }
}
