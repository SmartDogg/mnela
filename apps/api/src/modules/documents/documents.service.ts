import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { sha256File } from '../imports/upload.config.js';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  AttachmentRepository,
  type DocumentListFilters,
  DocumentRepository,
  JobRepository,
  PrismaService,
  ProjectRepository,
  type UpdateDocumentInput,
} from '@mnela/db';
import { readClaudeStatus, readWhisperStatus } from '@mnela/queue';
import { Prisma } from '@prisma/client';
import type { Attachment, Document, Job } from '@prisma/client';

import { loadEnv } from '../../env.js';
import { QueueService } from '../../queue/queue.service.js';
import { RedisService } from '../../redis.service.js';

const PHASE2_MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB; ZIP imports go through /imports.

export interface UploadFileInput {
  /** Absolute path where Multer streamed the upload. */
  path: string;
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

export interface AttachmentStreamInput {
  range?: string;
}

export interface AttachmentStreamResult {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  stream?: Readable;
  filename: string;
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
    private readonly attachments: AttachmentRepository,
    private readonly redis: RedisService,
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
    if (file.size === 0) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new UnsupportedMediaTypeException('Empty file');
    }
    if (file.size > PHASE2_MAX_UPLOAD_BYTES) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new UnsupportedMediaTypeException(
        `File too large: ${file.size} bytes (max ${PHASE2_MAX_UPLOAD_BYTES})`,
      );
    }

    const importBatchId = crypto.randomUUID();
    const contentHash = await sha256File(file.path);
    await fs.mkdir(this.uploadsDir, { recursive: true });
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = path.join(this.uploadsDir, `${importBatchId}-${safeName}`);
    try {
      await fs.rename(file.path, uploadPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        await fs.copyFile(file.path, uploadPath);
        await fs.unlink(file.path).catch(() => undefined);
      } else {
        throw err;
      }
    }

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

  /**
   * Entities Claude extracted from this document (DocumentEntity rows). The
   * graph view groups entities into nodes, this endpoint surfaces the
   * doc → entity side of the same join so /documents/:id can show "mentioned
   * here, click to jump into the graph". Filtered to non-merged entities.
   */
  async listEntities(id: string): Promise<
    {
      entityId: string;
      name: string;
      type: string;
      mentions: number;
      context: string | null;
    }[]
  > {
    await this.findById(id);
    const rows = await this.prisma.active().documentEntity.findMany({
      where: { documentId: id, entity: { mergedIntoId: null } },
      orderBy: [{ mentions: 'desc' }, { entityId: 'asc' }],
      include: { entity: { select: { id: true, name: true, type: true } } },
    });
    return rows.map((r) => ({
      entityId: r.entity.id,
      name: r.entity.name,
      type: r.entity.type,
      mentions: r.mentions,
      context: r.context,
    }));
  }

  /**
   * Attachments persisted next to a document. Images carry description +
   * ocrText (filled by the analyze_attachment pipeline) and a linkedDocumentId
   * pointing at the companion image Document. Non-image attachments only
   * have filename/mime/size.
   */
  async listAttachments(id: string): Promise<
    {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      createdAt: string;
      description: string | null;
      ocrText: string | null;
      analyzedAt: string | null;
      linkedDocumentId: string | null;
    }[]
  > {
    await this.findById(id);
    const rows = await this.prisma.active().attachment.findMany({
      where: { documentId: id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      size: r.size,
      createdAt: r.createdAt.toISOString(),
      description: r.description,
      ocrText: r.ocrText,
      analyzedAt: r.analyzedAt?.toISOString() ?? null,
      linkedDocumentId: r.linkedDocumentId,
    }));
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

  async reenrich(id: string): Promise<{ jobId: string }> {
    const doc = await this.findById(id);
    if (doc.archivedAt) {
      throw new ConflictException(`Document ${id} is archived`);
    }
    const claude = await readClaudeStatus(this.redis.client);
    if (!claude.available) {
      throw new ServiceUnavailableException({
        title: 'AI Smart Mode disabled',
        reason: claude.reason ?? 'unknown',
        hint:
          claude.reason === 'no-binary'
            ? 'Install the Claude Code CLI on the server and run `claude login`.'
            : claude.reason === 'not-logged-in'
              ? 'Run `claude login` on the server to authenticate the orchestrator.'
              : claude.reason === 'orchestrator-not-running'
                ? 'Start the orchestrator app (or wait for the boot probe to finish).'
                : 'Claude rate limit hit — try again after the window resets.',
      });
    }
    const job = await this.jobs.create({
      type: 'enrich_document',
      payload: { documentId: id, reenrich: true },
      documentId: id,
    });
    await this.queue.enqueueEnrichment({ dbJobId: job.id, documentId: id });
    return { jobId: job.id };
  }

  async retranscribe(id: string): Promise<{ jobId: string }> {
    const doc = await this.findById(id);
    if (doc.type !== 'audio') {
      throw new ConflictException(`Document ${id} is not audio (type=${doc.type ?? 'null'})`);
    }
    const whisper = await readWhisperStatus(this.redis.client);
    if (!whisper.available) {
      throw new ServiceUnavailableException({
        title: 'Whisper unavailable',
        reason: whisper.reason ?? 'unknown',
        hint:
          whisper.reason === 'not-enabled'
            ? 'Set MNELA_TRANSCRIPTION=enabled and start the whisper container with --profile optional'
            : 'Check that the whisper container is running and healthy',
      });
    }
    const job = await this.jobs.create({
      type: 'transcribe_audio',
      payload: { documentId: id, retranscribe: true },
      documentId: id,
    });
    await this.queue.enqueueTranscribeAudio({ dbJobId: job.id, documentId: id });
    return { jobId: job.id };
  }

  async retranscribePending(limit = 50): Promise<{ enqueued: number; jobIds: string[] }> {
    const whisper = await readWhisperStatus(this.redis.client);
    if (!whisper.available) {
      throw new ServiceUnavailableException({
        title: 'Whisper unavailable',
        reason: whisper.reason ?? 'unknown',
      });
    }
    const pending = await this.prisma.active().document.findMany({
      where: { type: 'audio', status: 'raw' },
      select: { id: true },
      take: Math.min(limit, 200),
      orderBy: { createdAt: 'asc' },
    });
    const jobIds: string[] = [];
    for (const { id } of pending) {
      const job = await this.jobs.create({
        type: 'transcribe_audio',
        payload: { documentId: id, backfill: true },
        documentId: id,
      });
      await this.queue.enqueueTranscribeAudio({ dbJobId: job.id, documentId: id });
      jobIds.push(job.id);
    }
    return { enqueued: jobIds.length, jobIds };
  }

  async streamAttachment(
    id: string,
    input: AttachmentStreamInput,
  ): Promise<AttachmentStreamResult> {
    const doc = await this.findById(id);
    if (doc.archivedAt) {
      throw new NotFoundException(`Document ${id} is archived`);
    }
    const atts = await this.attachments.listForDocument(id);
    const att: Attachment | undefined =
      atts.find((a) => doc.type === 'audio' && a.mimeType.startsWith('audio/')) ?? atts[0];
    if (!att) {
      throw new NotFoundException(`Document ${id} has no attachment`);
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(att.path);
    } catch {
      throw new NotFoundException(`Attachment file missing on disk: ${att.path}`);
    }
    const totalSize = stat.size;
    const safeFilename = att.filename.replace(/[\r\n"\\]/g, '_');
    const baseHeaders: Record<string, string> = {
      'Content-Type': att.mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${safeFilename}"`,
      'Cache-Control': 'private, max-age=0',
    };

    const range = input.range;
    if (!range) {
      return {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(totalSize) },
        stream: createReadStream(att.path),
        filename: att.filename,
      };
    }

    const parsed = parseRangeHeader(range, totalSize);
    if (!parsed) {
      return {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${totalSize}` },
        filename: att.filename,
      };
    }
    const { start, end } = parsed;
    return {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(end - start + 1),
      },
      stream: createReadStream(att.path, { start, end }),
      filename: att.filename,
    };
  }
}

function parseRangeHeader(
  header: string,
  totalSize: number,
): { start: number; end: number } | null {
  // Only single-range `bytes=START-END?` (no multipart). Anything else → 416.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (startRaw === '' && endRaw === '') return null;
  const lastByte = totalSize - 1;
  if (startRaw === '') {
    // Suffix range: last N bytes.
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const start = Math.max(0, totalSize - suffix);
    return { start, end: lastByte };
  }
  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start) || start < 0 || start > lastByte) return null;
  const end = endRaw === '' ? lastByte : Math.min(Number.parseInt(endRaw, 10), lastByte);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}
