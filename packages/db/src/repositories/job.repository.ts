import { Prisma } from '@prisma/client';
import type { Job, JobStatus, JobType } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateJobInput {
  type: JobType;
  payload: Prisma.InputJsonValue;
  priority?: number;
  documentId?: string | null;
  maxAttempts?: number;
}

export interface JobListFilters {
  status?: JobStatus;
  type?: JobType;
  /** Filter by `Job.payload->>source` — used by /activity?tab=uploads
   * to slice ingest jobs by provenance (manual_upload / telegram /
   * api_ingest / etc.). */
  payloadSource?: string;
}

export interface JobStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
  cancelled: number;
}

export class JobRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateJobInput): Promise<Job> {
    return this.getPrisma().job.create({ data: input });
  }

  findById(id: string): Promise<Job | null> {
    return this.getPrisma().job.findUnique({ where: { id } });
  }

  async list(filters: JobListFilters = {}, opts: PageOptions = {}): Promise<Page<Job>> {
    const params = paginationParams(opts);
    const where: Prisma.JobWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.payloadSource) {
      // Legacy ingest jobs (pre ADR-0053) have no `source` key on payload;
      // the /imports/sources aggregator COALESCEs them under
      // `manual_upload`, so the filter needs the same fallback to stay
      // consistent — otherwise `?source=manual_upload` returns zero rows
      // even when the dropdown shows "Manual upload (N)".
      if (filters.payloadSource === 'manual_upload') {
        where.OR = [
          { payload: { path: ['source'], equals: 'manual_upload' } },
          { payload: { path: ['source'], equals: Prisma.AnyNull } },
        ];
      } else {
        where.payload = { path: ['source'], equals: filters.payloadSource };
      }
    }
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.job.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  setStatus(id: string, status: JobStatus, error?: string | null): Promise<Job> {
    const data: Prisma.JobUpdateInput = { status };
    if (status === 'running') data.startedAt = new Date();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      data.completedAt = new Date();
    }
    if (error !== undefined) data.error = error;
    return this.getPrisma().job.update({ where: { id }, data });
  }

  bumpAttempts(id: string): Promise<Job> {
    return this.getPrisma().job.update({
      where: { id },
      data: { attempts: { increment: 1 }, status: 'queued' },
    });
  }

  async stats(): Promise<JobStats> {
    const prisma = this.getPrisma();
    const groups = await prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: JobStats = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
    };
    for (const g of groups) {
      out[g.status] = g._count._all;
    }
    return out;
  }
}
