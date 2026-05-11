import type { Conversation, Prisma } from '@prisma/client';

import { type Page, type PageOptions, makePage, paginationParams } from './pagination.js';
import type { PrismaProvider } from './types.js';

export interface CreateConversationInput {
  adminUserId: string;
  title: string;
}

export interface UpdateConversationInput {
  title?: string;
  synthesisDocumentId?: string | null;
}

export class ConversationRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  create(input: CreateConversationInput): Promise<Conversation> {
    return this.getPrisma().conversation.create({ data: input });
  }

  findById(id: string): Promise<Conversation | null> {
    return this.getPrisma().conversation.findUnique({ where: { id } });
  }

  async listByUser(adminUserId: string, opts: PageOptions = {}): Promise<Page<Conversation>> {
    const params = paginationParams(opts);
    const prisma = this.getPrisma();
    const where: Prisma.ConversationWhereInput = { adminUserId };
    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.conversation.count({ where }),
    ]);
    return makePage(items, total, params);
  }

  update(id: string, input: UpdateConversationInput): Promise<Conversation> {
    return this.getPrisma().conversation.update({
      where: { id },
      data: input,
    });
  }

  touch(id: string): Promise<Conversation> {
    return this.getPrisma().conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  delete(id: string): Promise<Conversation> {
    return this.getPrisma().conversation.delete({ where: { id } });
  }
}
