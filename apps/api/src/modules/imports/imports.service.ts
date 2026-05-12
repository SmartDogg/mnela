import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { BadRequestException, Injectable } from '@nestjs/common';
import { JobRepository, PrismaService } from '@mnela/db';
import type { Job, Prisma } from '@prisma/client';

import { loadEnv } from '../../env.js';
import { QueueService } from '../../queue/queue.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SystemService } from '../system/system.service.js';
import { sha256File } from './upload.config.js';

export interface ImportFileInput {
  /** Absolute path where Multer streamed the upload (in uploads/.incoming/). */
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

interface ImportPayload {
  importBatchId: string;
  uploadPath: string;
  filename: string;
  mimetype: string;
  size: number;
  contentHash: string;
  receivedAt: string;
  origin: 'upload' | 'dropbox' | 'api_ingest';
  status: 'received' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
}

@Injectable()
export class ImportsService {
  private readonly uploadsDir: string;

  constructor(
    private readonly jobs: JobRepository,
    private readonly jobsService: JobsService,
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly system: SystemService,
  ) {
    const env = loadEnv();
    this.uploadsDir = path.resolve(env.MNELA_DATA_DIR, 'uploads');
  }

  async createFromUpload(file: ImportFileInput): Promise<Job> {
    if (file.size === 0) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException('Empty file');
    }
    const maxBytes = await this.system.getConfig<number>('imports.maxBytes');
    if (file.size > maxBytes) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        `Import too large: ${file.size} bytes (max ${maxBytes}; raise SystemConfig.imports.maxBytes in /admin/system)`,
      );
    }

    const importBatchId = crypto.randomUUID();
    const contentHash = await sha256File(file.path);
    await fs.mkdir(this.uploadsDir, { recursive: true });
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = path.join(this.uploadsDir, `${importBatchId}-${safeName}`);
    // Atomic on same-fs (typical dev/prod). For cross-fs, fall back to copy+unlink.
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

    const payload: ImportPayload = {
      importBatchId,
      uploadPath,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      contentHash,
      receivedAt: new Date().toISOString(),
      origin: 'upload',
      status: 'received',
    };

    const job = await this.jobs.create({
      type: 'ingest_file',
      payload: payload as unknown as Prisma.InputJsonValue,
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

    return job;
  }

  async list(page?: number, limit?: number) {
    return this.jobs.list({ type: 'ingest_file' }, { page, limit });
  }

  async findOne(id: string) {
    const job = await this.jobsService.findById(id);
    if (job.type !== 'ingest_file') {
      throw new BadRequestException(`Job ${id} is not an import (type=${job.type})`);
    }
    return job;
  }

  async start(id: string) {
    const job = await this.findOne(id);
    if (job.status !== 'queued' && job.status !== 'paused') {
      throw new BadRequestException(`Cannot start import in status ${job.status}`);
    }
    return this.jobsService.setStatus(id, 'queued');
  }

  async pause(id: string) {
    const job = await this.findOne(id);
    if (job.status !== 'running' && job.status !== 'queued') {
      throw new BadRequestException(`Cannot pause import in status ${job.status}`);
    }
    return this.jobsService.setStatus(id, 'paused');
  }

  async cancel(id: string) {
    await this.findOne(id);
    await this.queue.cancel(id);
    return this.jobsService.cancel(id);
  }

  async listDocuments(
    id: string,
  ): Promise<{ id: string; title: string; status: string; chunkCount?: number }[]> {
    await this.findOne(id);
    const rows = await this.prisma.active().document.findMany({
      where: { metadata: { path: ['__import', 'jobId'], equals: id } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, status: true, _count: { select: { chunks: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      chunkCount: r._count.chunks,
    }));
  }
}
