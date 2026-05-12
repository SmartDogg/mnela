import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JobRepository, type JobListFilters, PrismaService } from '@mnela/db';
import { type EnrichmentSnapshot } from '@mnela/queue';
import { Prisma, type Job, type JobStatus } from '@prisma/client';

import { QueueService } from '../../queue/queue.service.js';
import { SINCE_MS, type StatsSince, type ThroughputBucket } from './dto.js';

export interface ThroughputBucketRow {
  ts: string;
  count: number;
}

export interface ThroughputStats {
  buckets: ThroughputBucketRow[];
}

export interface DurationStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  total: number;
}

export interface ErrorRateStats {
  totalCompleted: number;
  totalFailed: number;
  rate: number;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Snapshot of the enrichment queue + slot + paused reasons — initial load
   * for /jobs. Live updates ride the `enrichment.queue.tick` Socket.io event. */
  getEnrichmentQueueState(): Promise<EnrichmentSnapshot> {
    return this.queue.getEnrichmentQueueSnapshot();
  }

  setEnrichmentQueuePaused(paused: boolean): Promise<void> {
    return this.queue.setEnrichmentPaused(paused);
  }

  list(filters: JobListFilters, page?: number, limit?: number) {
    return this.jobs.list(filters, { page, limit });
  }

  async findById(id: string): Promise<Job> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.findById(id);
    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new BadRequestException(`Job ${id} is already ${job.status}`);
    }
    return this.jobs.setStatus(id, 'cancelled');
  }

  async retry(id: string): Promise<Job> {
    const job = await this.findById(id);
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new BadRequestException(
        `Only failed or cancelled jobs can be retried (got ${job.status})`,
      );
    }
    return this.jobs.bumpAttempts(id);
  }

  setStatus(id: string, status: JobStatus): Promise<Job> {
    return this.jobs.setStatus(id, status);
  }

  stats() {
    return this.jobs.stats();
  }

  async throughput(
    bucket: ThroughputBucket = 'minute',
    since: StatsSince = '1h',
  ): Promise<ThroughputStats> {
    const sinceDate = new Date(Date.now() - SINCE_MS[since]);
    const truncUnit = bucket === 'hour' ? 'hour' : 'minute';
    // Group completed jobs by date_trunc(unit, completedAt) and count per bucket.
    const rows = await this.prisma.active().$queryRaw<{ ts: Date; count: bigint }[]>(Prisma.sql`
      SELECT date_trunc(${truncUnit}, "completedAt") AS ts, COUNT(*)::bigint AS count
      FROM "Job"
      WHERE "status" = 'completed'
        AND "completedAt" IS NOT NULL
        AND "completedAt" >= ${sinceDate}
      GROUP BY ts
      ORDER BY ts ASC
    `);
    return {
      buckets: rows.map((r) => ({ ts: r.ts.toISOString(), count: Number(r.count) })),
    };
  }

  async durations(since: StatsSince = '24h'): Promise<DurationStats> {
    const sinceDate = new Date(Date.now() - SINCE_MS[since]);
    // Pull duration in ms for each completed job in the window with both timestamps set.
    const rows = await this.prisma.active().$queryRaw<{ duration_ms: number }[]>(Prisma.sql`
      SELECT EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000 AS duration_ms
      FROM "Job"
      WHERE "status" = 'completed'
        AND "completedAt" IS NOT NULL
        AND "startedAt" IS NOT NULL
        AND "completedAt" >= ${sinceDate}
    `);
    if (rows.length === 0) {
      return { avgMs: 0, p50Ms: 0, p95Ms: 0, total: 0 };
    }
    const sorted = rows.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
    const sum = sorted.reduce((acc, x) => acc + x, 0);
    const avgMs = sum / sorted.length;
    const p50Ms = quantile(sorted, 0.5);
    const p95Ms = quantile(sorted, 0.95);
    return {
      avgMs: roundMs(avgMs),
      p50Ms: roundMs(p50Ms),
      p95Ms: roundMs(p95Ms),
      total: sorted.length,
    };
  }

  async errorRate(since: StatsSince = '24h'): Promise<ErrorRateStats> {
    const sinceDate = new Date(Date.now() - SINCE_MS[since]);
    const [totalCompleted, totalFailed] = await Promise.all([
      this.prisma
        .active()
        .job.count({ where: { status: 'completed', completedAt: { gte: sinceDate } } }),
      this.prisma
        .active()
        .job.count({ where: { status: 'failed', completedAt: { gte: sinceDate } } }),
    ]);
    const denom = totalCompleted + totalFailed;
    const rate = denom === 0 ? 0 : totalFailed / denom;
    return { totalCompleted, totalFailed, rate };
  }
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  // Linear interpolation between the two surrounding samples (NIST type 7).
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = pos - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

function roundMs(n: number): number {
  return Math.round(n);
}
