import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type CreateProjectInput,
  JobRepository,
  ProjectRepository,
  type UpdateProjectInput,
} from '@mnela/db';
import { readClaudeStatus } from '@mnela/queue';
import type { Project } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { QueueService } from '../../queue/queue.service.js';
import { RedisService } from '../../redis.service.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly jobs: JobRepository,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
  ) {}

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      return await this.projects.create(input);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Project with slug "${input.slug}" already exists`);
      }
      throw err;
    }
  }

  list(page?: number, limit?: number) {
    return this.projects.list({ page, limit });
  }

  async findBySlug(slug: string): Promise<Project> {
    const p = await this.projects.findBySlug(slug);
    if (!p) throw new NotFoundException(`Project "${slug}" not found`);
    return p;
  }

  async update(slug: string, patch: UpdateProjectInput): Promise<Project> {
    await this.findBySlug(slug);
    return this.projects.update(slug, patch);
  }

  async delete(slug: string): Promise<{ slug: string; deleted: true }> {
    await this.findBySlug(slug);
    await this.projects.delete(slug);
    return { slug, deleted: true };
  }

  async getContext(slug: string): Promise<{ slug: string; contextMd: string | null }> {
    const p = await this.findBySlug(slug);
    return { slug: p.slug, contextMd: p.contextMd };
  }

  async refreshContext(slug: string): Promise<{ jobId: string }> {
    const project = await this.findBySlug(slug);
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
      type: 'refresh_project_context',
      payload: { projectSlug: project.slug, projectId: project.id },
    });
    await this.queue.enqueueEnrichment({ dbJobId: job.id, projectSlug: project.slug });
    return { jobId: job.id };
  }
}
