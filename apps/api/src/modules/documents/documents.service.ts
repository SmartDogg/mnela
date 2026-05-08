import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  type DocumentListFilters,
  DocumentRepository,
  JobRepository,
  ProjectRepository,
  type UpdateDocumentInput,
} from '@mnela/db';
import { Prisma } from '@prisma/client';
import type { Document, Job } from '@prisma/client';

import { loadEnv } from '../../env.js';
import { PrismaService } from '../../prisma.service.js';
import { QueueService } from '../../queue/queue.service.js';

const PHASE2_MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB; ZIP imports go through /imports.

export interface UploadFileInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadAccepted {
  job: Job;
  duplicate: false;
  accepted: true;
}

interface RelatedRow {
  id: string;
  title: string;
  similarity: number;
}

@Injectable()
export class DocumentsService {
  private readonly uploadsDir: string;

  constructor(
    private readonly documents: DocumentRepository,
    private readonly projects: ProjectRepository,
    private readonly prisma: PrismaService,
    private readonly jobs: JobRepository,
    private readonly queue: QueueService,
  ) {
    void this.projects;
    const env = loadEnv();
    this.uploadsDir = path.resolve(env.MNELA_DATA_DIR, 'uploads');
  }

  /**
   * Phase-2 contract: every upload is asynchronous. The route persists the file
   * and creates a Job; the worker parses, deduplicates by content_hash, and
   * writes the Document(s). Caller polls /jobs/:id (or subscribes to
   * Socket.io /live) for completion.
   */
  async upload(file: UploadFileInput): Promise<UploadAccepted> {
    if (!file.buffer || file.size === 0) {
      throw new UnsupportedMediaTypeException('Empty file');
    }
    if (file.size > PHASE2_MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaTypeException(
        `File too large: ${file.size} bytes (max ${PHASE2_MAX_UPLOAD_BYTES})`,
      );
    }

    const importBatchId = crypto.randomUUID();
    const contentHash = sha256Hex(file.buffer);
    await fs.mkdir(this.uploadsDir, { recursive: true });
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = path.join(this.uploadsDir, `${importBatchId}-${safeName}`);
    await fs.writeFile(uploadPath, file.buffer);

    const job = await this.jobs.create({
      type: 'ingest_file',
      payload: {
        importBatchId,
        uploadPath,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        contentHash,
        receivedAt: new Date().toISOString(),
        origin: 'upload',
        status: 'received',
      } as unknown as Prisma.InputJsonValue,
      priority: 50,
    });

    await this.queue.enqueueIngestFile({
      dbJobId: job.id,
      filePath: uploadPath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      contentHash,
      origin: 'upload',
      importBatchId,
    });

    return { job, duplicate: false, accepted: true };
  }

  async list(filters: DocumentListFilters, page?: number, limit?: number) {
    return this.documents.list(filters, { page, limit });
  }

  async findById(id: string): Promise<Document> {
    const doc = await this.documents.findById(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    patch: { type?: string | null; archived?: boolean; projects?: string[] },
  ): Promise<Document> {
    await this.findById(id);
    const updateInput: UpdateDocumentInput = {};
    if (patch.type !== undefined) updateInput.type = patch.type;
    if (patch.archived !== undefined) updateInput.archived = patch.archived;

    const document = await this.documents.update(id, updateInput);

    if (patch.projects !== undefined) {
      const found = await this.prisma
        .active()
        .project.findMany({ where: { slug: { in: patch.projects } } });
      const missing = patch.projects.filter((slug) => !found.some((p) => p.slug === slug));
      if (missing.length > 0) {
        throw new ConflictException(`Unknown project slug(s): ${missing.join(', ')}`);
      }
      await this.documents.setProjects(
        id,
        found.map((p) => p.id),
      );
    }

    return document;
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    await this.findById(id);
    await this.documents.delete(id);
    return { id, deleted: true };
  }

  async getChunks(id: string) {
    await this.findById(id);
    return this.documents.getChunks(id);
  }

  async findRelated(
    id: string,
    limit = 10,
  ): Promise<{ id: string; title: string; similarity: number }[]> {
    const doc = await this.findById(id);
    const rows = await this.prisma.active().$queryRaw<RelatedRow[]>(Prisma.sql`
      SELECT d.id, d.title, similarity(d.title, ${doc.title})::float AS similarity
      FROM "Document" d
      WHERE d.id <> ${id}
        AND similarity(d.title, ${doc.title}) > 0.2
      ORDER BY similarity DESC, d."createdAt" DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({ id: r.id, title: r.title, similarity: Number(r.similarity) }));
  }
}

function sha256Hex(input: Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
