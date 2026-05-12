import type { Document, DocumentChunk, DocumentStatus, Prisma, SourceType } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface DocumentListFilters {
  status?: DocumentStatus;
  source?: SourceType;
  type?: string;
  projectSlug?: string;
  q?: string;
  archived?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  languages?: string[];
}

export interface CreateDocumentInput {
  source: SourceType;
  sourceId?: string | null;
  title: string;
  rawText: string;
  cleanText?: string | null;
  contentHash: string;
  tokenCount?: number | null;
  language?: string | null;
  type?: string | null;
  metadata?: Prisma.InputJsonValue;
  status?: DocumentStatus;
  vaultPath?: string | null;
}

export interface UpdateDocumentInput {
  type?: string | null;
  archived?: boolean;
  status?: DocumentStatus;
  metadata?: Prisma.InputJsonValue;
  rawText?: string;
  cleanText?: string | null;
}

export class DocumentRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(data: CreateDocumentInput): Promise<Document> {
    return this.getPrisma().document.create({ data });
  }

  findById(id: string): Promise<Document | null> {
    return this.getPrisma().document.findUnique({ where: { id } });
  }

  findByContentHash(contentHash: string): Promise<Document | null> {
    return this.getPrisma().document.findUnique({ where: { contentHash } });
  }

  findManyByIds(ids: readonly string[]): Promise<Document[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.getPrisma().document.findMany({ where: { id: { in: [...ids] } } });
  }

  async list(filters: DocumentListFilters = {}, opts: PageOptions = {}): Promise<Page<Document>> {
    const params = paginationParams(opts);
    const where: Prisma.DocumentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    if (filters.type) where.type = filters.type;
    if (filters.archived === false) where.archivedAt = null;
    if (filters.archived === true) where.archivedAt = { not: null };
    if (filters.projectSlug) {
      where.documentProjects = { some: { project: { slug: filters.projectSlug } } };
    }
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { rawText: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.dateFrom) createdAt.gte = filters.dateFrom;
      if (filters.dateTo) createdAt.lte = filters.dateTo;
      where.createdAt = createdAt;
    }
    if (filters.languages && filters.languages.length > 0) {
      where.language = { in: filters.languages };
    }
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  async update(id: string, patch: UpdateDocumentInput): Promise<Document> {
    const data: Prisma.DocumentUpdateInput = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.metadata !== undefined) data.metadata = patch.metadata;
    if (patch.rawText !== undefined) data.rawText = patch.rawText;
    if (patch.cleanText !== undefined) data.cleanText = patch.cleanText;
    if (patch.archived === true) {
      data.archivedAt = new Date();
      data.status = 'archived';
    } else if (patch.archived === false) {
      data.archivedAt = null;
    }
    return this.getPrisma().document.update({ where: { id }, data });
  }

  delete(id: string): Promise<Document> {
    return this.getPrisma().document.delete({ where: { id } });
  }

  getChunks(documentId: string): Promise<DocumentChunk[]> {
    return this.getPrisma().documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  async setProjects(documentId: string, projectIds: string[]): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.documentProject.deleteMany({ where: { documentId } });
    if (projectIds.length > 0) {
      await prisma.documentProject.createMany({
        data: projectIds.map((projectId) => ({ documentId, projectId })),
        skipDuplicates: true,
      });
    }
  }
}
