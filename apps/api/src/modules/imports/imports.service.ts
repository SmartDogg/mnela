import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { BadRequestException, Injectable } from '@nestjs/common';
import { JobRepository } from '@mnela/db';
import type { Job, Prisma } from '@prisma/client';

import { loadEnv } from '../../env.js';
import { JobsService } from '../jobs/jobs.service.js';

export interface ImportFileInput {
  buffer: Buffer;
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
  status: 'received' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
}

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024; // 1 GB

@Injectable()
export class ImportsService {
  private readonly uploadsDir: string;

  constructor(
    private readonly jobs: JobRepository,
    private readonly jobsService: JobsService,
  ) {
    const env = loadEnv();
    this.uploadsDir = path.resolve(env.MNELA_DATA_DIR, 'uploads');
  }

  async createFromUpload(file: ImportFileInput): Promise<Job> {
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException('Empty file');
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new BadRequestException(
        `Import too large: ${file.size} bytes (max ${MAX_IMPORT_BYTES})`,
      );
    }
    const importBatchId = crypto.randomUUID();
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    await fs.mkdir(this.uploadsDir, { recursive: true });
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = path.join(this.uploadsDir, `${importBatchId}-${safeName}`);
    await fs.writeFile(uploadPath, file.buffer);

    const payload: ImportPayload = {
      importBatchId,
      uploadPath,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      contentHash,
      receivedAt: new Date().toISOString(),
      status: 'received',
    };

    return this.jobs.create({
      type: 'ingest_file',
      payload: payload as unknown as Prisma.InputJsonValue,
      priority: 50,
    });
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
    return this.jobsService.cancel(id);
  }
}
