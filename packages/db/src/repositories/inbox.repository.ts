import type { InboxItem, InboxItemType, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateInboxItemInput {
  type: InboxItemType;
  title: string;
  description: string;
  payload: Prisma.InputJsonValue;
  documentId?: string | null;
  edgeId?: string | null;
  entityId?: string | null;
}

export interface InboxListFilters {
  type?: InboxItemType;
  status?: string;
}

export class InboxRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateInboxItemInput): Promise<InboxItem> {
    return this.getPrisma().inboxItem.create({ data: input });
  }

  findById(id: string): Promise<InboxItem | null> {
    return this.getPrisma().inboxItem.findUnique({ where: { id } });
  }

  async list(filters: InboxListFilters = {}, opts: PageOptions = {}): Promise<Page<InboxItem>> {
    const params = paginationParams(opts);
    const where: Prisma.InboxItemWhereInput = {};
    if (filters.type) where.type = filters.type;
    where.status = filters.status ?? 'pending';
    const prisma = this.getPrisma();
    const [items, total] = await Promise.all([
      prisma.inboxItem.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inboxItem.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  resolve(id: string, status: 'accepted' | 'rejected', resolvedBy: string): Promise<InboxItem> {
    return this.getPrisma().inboxItem.update({
      where: { id },
      data: { status, resolvedAt: new Date(), resolvedBy },
    });
  }

  updatePayload(id: string, payload: Prisma.InputJsonValue): Promise<InboxItem> {
    return this.getPrisma().inboxItem.update({
      where: { id },
      data: { payload },
    });
  }
}
