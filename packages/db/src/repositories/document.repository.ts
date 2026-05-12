import type {
  Document,
  DocumentChunk,
  DocumentStatus,
  Prisma,
  PrismaClient,
  SourceType,
} from '@prisma/client';

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
  /** Title can change between re-exports (user renamed a ChatGPT/Claude
   * conversation) — keep it editable. */
  title?: string;
  /** Refresh on content change. The DB has a unique constraint on
   * `contentHash`, so updating to a hash already used by ANOTHER document
   * would throw — callers should detect that case before calling. */
  contentHash?: string;
  tokenCount?: number | null;
  language?: string | null;
}

/**
 * Atomic content-replacement for re-imports: rewrites the Document body +
 * hash + chunks in a single transaction so callers can't observe the
 * Document with old chunks (or vice-versa). Mirrors persistDocument's
 * write surface so the import path can route both "first create" and
 * "subsequent update" through one repository.
 */
export interface ReplaceContentInput {
  rawText: string;
  cleanText?: string | null;
  contentHash: string;
  tokenCount: number;
  language?: string | null;
  title: string;
  type?: string | null;
  status: DocumentStatus;
  metadata: Prisma.InputJsonValue;
  chunks: { chunkIndex: number; text: string; tokenCount: number }[];
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

  /**
   * Look up the existing Document for a (source, sourceId) pair. Lets the
   * ingestion worker detect "this is the same ChatGPT/Claude conversation
   * I've seen before" — independent of whether the user added new messages
   * since the last export, which would change contentHash but never the
   * sourceId UUID. Uses the `(source, sourceId)` index from the Prisma
   * schema; returns the first match (sourceId is functionally unique per
   * source in practice but the schema doesn't enforce it).
   */
  findBySourceAndSourceId(source: SourceType, sourceId: string): Promise<Document | null> {
    return this.getPrisma().document.findFirst({
      where: { source, sourceId },
      orderBy: { createdAt: 'asc' },
    });
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
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.contentHash !== undefined) data.contentHash = patch.contentHash;
    if (patch.tokenCount !== undefined) data.tokenCount = patch.tokenCount;
    if (patch.language !== undefined) data.language = patch.language;
    if (patch.archived === true) {
      data.archivedAt = new Date();
      data.status = 'archived';
    } else if (patch.archived === false) {
      data.archivedAt = null;
    }
    return this.getPrisma().document.update({ where: { id }, data });
  }

  /**
   * Re-import path: a chat with the same (source, sourceId) returned with
   * new content (e.g. additional messages since the last export). Replace
   * body + hash + chunks atomically so a concurrent reader never sees
   * the body and chunks out of sync.
   */
  async replaceContent(id: string, args: ReplaceContentInput): Promise<Document> {
    // Cast to PrismaClient: callers in apps/worker pass the root client (not
    // a nested TransactionClient), so $transaction is always available at
    // runtime. The PrismaProvider type widens to include TransactionClient
    // for repositories that need to compose into outer transactions; this
    // repo's replaceContent OPENS a transaction itself.
    const client = this.getPrisma() as PrismaClient;
    return client.$transaction(async (tx) => {
      const data: Prisma.DocumentUpdateInput = {
        rawText: args.rawText,
        contentHash: args.contentHash,
        tokenCount: args.tokenCount,
        title: args.title,
        status: args.status,
        metadata: args.metadata,
      };
      if (args.cleanText !== undefined) data.cleanText = args.cleanText;
      if (args.language !== undefined) data.language = args.language;
      if (args.type !== undefined) data.type = args.type;
      const updated = await tx.document.update({ where: { id }, data });
      await tx.documentChunk.deleteMany({ where: { documentId: id } });
      if (args.chunks.length > 0) {
        await tx.documentChunk.createMany({
          data: args.chunks.map((c) => ({
            documentId: id,
            chunkIndex: c.chunkIndex,
            text: c.text,
            tokenCount: c.tokenCount,
          })),
        });
      }
      return updated;
    });
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
