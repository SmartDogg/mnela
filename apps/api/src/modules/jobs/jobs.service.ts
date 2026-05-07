import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JobRepository, type JobListFilters } from '@mnela/db';
import type { Job, JobStatus } from '@prisma/client';

@Injectable()
export class JobsService {
  constructor(private readonly jobs: JobRepository) {}

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
}
