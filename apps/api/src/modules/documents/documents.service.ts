import crypto from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  type DocumentListFilters,
  DocumentRepository,
  ProjectRepository,
  type UpdateDocumentInput,
} from '@mnela/db';
import { Prisma } from '@prisma/client';
import type { Document } from '@prisma/client';

import { PrismaService } from '../../prisma.service.js';

const ALLOWED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/x-markdown',
]);

const PHASE1_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadFileInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadResult {
  document: Document;
  duplicate: boolean;
}

interface RelatedRow {
  id: string;
  title: string;
  similarity: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly projects: ProjectRepository,
    private readonly prisma: PrismaService,
  ) {}

  async upload(file: UploadFileInput): Promise<UploadResult> {
    if (!file.buffer || file.size === 0) {
      throw new UnsupportedMediaTypeException('Empty file');
    }
    if (file.size > PHASE1_MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaTypeException(
        `File too large: ${file.size} bytes (max ${PHASE1_MAX_UPLOAD_BYTES})`,
      );
    }
    if (!ALLOWED_TEXT_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Phase-1 upload only supports text/plain, text/markdown, and application/json (got ${file.mimetype}). Binary parsers land in Phase 2.`,
      );
    }

    const rawText = file.buffer.toString('utf-8');
    const contentHash = sha256Hex(file.buffer);
    const existing = await this.documents.findByContentHash(contentHash);
    if (existing) {
      return { document: existing, duplicate: true };
    }

    const document = await this.documents.create({
      source: 'manual_upload',
      title: stripExtension(file.originalname),
      rawText,
      contentHash,
      tokenCount: estimateTokenCount(rawText),
      type: inferType(file.mimetype),
      status: 'parsed',
      metadata: {
        originalFilename: file.originalname,
        uploadedMime: file.mimetype,
        uploadedSize: file.size,
      } as Prisma.InputJsonValue,
    });

    return { document, duplicate: false };
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

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function inferType(mimetype: string): string {
  if (mimetype.includes('markdown')) return 'note';
  if (mimetype === 'application/json') return 'data';
  return 'note';
}

function estimateTokenCount(text: string): number {
  // Rough heuristic until packages/ingestion lands in Phase 2 with gpt-tokenizer.
  // 1 token ≈ 4 chars for English/Russian mix.
  return Math.ceil(text.length / 4);
}
