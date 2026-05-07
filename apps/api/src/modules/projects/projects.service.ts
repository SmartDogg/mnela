import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type CreateProjectInput, ProjectRepository, type UpdateProjectInput } from '@mnela/db';
import type { Project } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private readonly projects: ProjectRepository) {}

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
}
