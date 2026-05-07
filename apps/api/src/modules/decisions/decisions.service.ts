import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateDecisionInput,
  DecisionRepository,
  ProjectRepository,
  type UpdateDecisionInput,
} from '@mnela/db';
import type { Decision } from '@prisma/client';

export interface CreateDecisionDtoInput extends Omit<CreateDecisionInput, 'projectId'> {
  projectSlug?: string;
}

@Injectable()
export class DecisionsService {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async create(input: CreateDecisionDtoInput): Promise<Decision> {
    let projectId: string | null | undefined = undefined;
    if (input.projectSlug) {
      const project = await this.projects.findBySlug(input.projectSlug);
      if (!project) throw new NotFoundException(`Project "${input.projectSlug}" not found`);
      projectId = project.id;
    }
    const data: CreateDecisionInput = {
      title: input.title,
      decision: input.decision,
    };
    if (projectId !== undefined) data.projectId = projectId;
    if (input.context !== undefined) data.context = input.context;
    if (input.consequences !== undefined) data.consequences = input.consequences;
    if (input.status !== undefined) data.status = input.status;
    if (input.sourceDocumentId !== undefined) data.sourceDocumentId = input.sourceDocumentId;
    return this.decisions.create(data);
  }

  list(filters: { projectSlug?: string; status?: string }, page?: number, limit?: number) {
    return this.decisions.list(filters, { page, limit });
  }

  async findById(id: string): Promise<Decision> {
    const d = await this.decisions.findById(id);
    if (!d) throw new NotFoundException(`Decision ${id} not found`);
    return d;
  }

  async update(id: string, patch: UpdateDecisionInput): Promise<Decision> {
    await this.findById(id);
    return this.decisions.update(id, patch);
  }
}
