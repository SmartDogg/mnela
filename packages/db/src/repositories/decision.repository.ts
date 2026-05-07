import type { Decision, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateDecisionInput {
  projectId?: string | null;
  title: string;
  decision: string;
  context?: string | null;
  consequences?: string | null;
  status?: string;
  supersededById?: string | null;
  sourceDocumentId?: string | null;
}

export interface UpdateDecisionInput {
  title?: string;
  decision?: string;
  context?: string | null;
  consequences?: string | null;
  status?: string;
  supersededById?: string | null;
}

export interface DecisionListFilters {
  projectSlug?: string;
  projectId?: string;
  status?: string;
}

export class DecisionRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(data: CreateDecisionInput): Promise<Decision> {
    return this.getPrisma().decision.create({ data });
  }

  findById(id: string): Promise<Decision | null> {
    return this.getPrisma().decision.findUnique({ where: { id } });
  }

  async list(filters: DecisionListFilters = {}, opts: PageOptions = {}): Promise<Page<Decision>> {
    const params = paginationParams(opts);
    const where: Prisma.DecisionWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.projectSlug) where.project = { slug: filters.projectSlug };
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.decision.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { decidedAt: 'desc' },
      }),
      prisma.decision.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  update(id: string, patch: UpdateDecisionInput): Promise<Decision> {
    return this.getPrisma().decision.update({ where: { id }, data: patch });
  }
}
