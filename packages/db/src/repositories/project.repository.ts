import type {
  DocumentProjectLinkSource,
  Prisma,
  Project,
  ProjectSource,
  ProjectStatus,
} from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateProjectInput {
  slug: string;
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  source?: ProjectSource;
  autoFill?: boolean;
  signature?: string | null;
  signatureMetrics?: Prisma.InputJsonValue;
  batchId?: string | null;
  contextMd?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  source?: ProjectSource;
  autoFill?: boolean;
  signature?: string | null;
  signatureMetrics?: Prisma.InputJsonValue;
  contextMd?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface ListProjectsFilters {
  status?: ProjectStatus | ProjectStatus[];
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

  findBySignature(signature: string): Promise<Project | null> {
    return this.getPrisma().project.findFirst({ where: { signature } });
  }

  async findBySignatures(signatures: string[]): Promise<Project[]> {
    if (signatures.length === 0) return [];
    return this.getPrisma().project.findMany({
      where: { signature: { in: signatures } },
    });
  }

  async findByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    return this.getPrisma().project.findMany({ where: { id: { in: ids } } });
  }

  async list(opts: PageOptions = {}, filters: ListProjectsFilters = {}): Promise<Page<Project>> {
    const params = paginationParams(opts);
    const prisma = this.getPrisma();
    const where: Prisma.ProjectWhereInput = {};
    if (filters.status !== undefined) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  update(slug: string, patch: UpdateProjectInput): Promise<Project> {
    return this.getPrisma().project.update({ where: { slug }, data: patch });
  }

  updateById(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.getPrisma().project.update({ where: { id }, data: patch });
  }

  delete(slug: string): Promise<Project> {
    return this.getPrisma().project.delete({ where: { slug } });
  }

  /** Count linked documents for a project (any linkSource). */
  countDocuments(projectId: string): Promise<number> {
    return this.getPrisma().documentProject.count({ where: { projectId } });
  }

  /**
   * Idempotent link of a Document to a Project. If the link already exists
   * we leave it untouched (`linkSource` doesn't get downgraded automatically;
   * call `upgradeLinkSource` if you need that).
   */
  async linkDocument(
    projectId: string,
    documentId: string,
    linkSource: DocumentProjectLinkSource,
  ): Promise<void> {
    await this.getPrisma().documentProject.upsert({
      where: { documentId_projectId: { documentId, projectId } },
      create: { projectId, documentId, linkSource },
      update: {},
    });
  }

  async linkDocuments(
    projectId: string,
    documentIds: string[],
    linkSource: DocumentProjectLinkSource,
  ): Promise<number> {
    if (documentIds.length === 0) return 0;
    const result = await this.getPrisma().documentProject.createMany({
      data: documentIds.map((documentId) => ({ projectId, documentId, linkSource })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Remove all `suggested`-source links for a project. Used on dismiss to
   * detach the auto-curated set without touching manual/autoFill links.
   */
  unlinkSuggested(projectId: string): Promise<Prisma.BatchPayload> {
    return this.getPrisma().documentProject.deleteMany({
      where: { projectId, linkSource: 'suggested' },
    });
  }
}
