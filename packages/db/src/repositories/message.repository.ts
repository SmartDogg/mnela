import { Prisma } from '@prisma/client';
import type { Message, MessageRole } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export interface AppendMessageInput {
  id?: string;
  conversationId: string;
  role: MessageRole;
  contentMd: string;
  citations?: Prisma.InputJsonValue;
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs?: number | null;
  dumbMode?: boolean;
  aborted?: boolean;
  metadata?: Prisma.InputJsonValue | null;
}

export class MessageRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  append(input: AppendMessageInput): Promise<Message> {
    const data: Prisma.MessageCreateInput = {
      conversation: { connect: { id: input.conversationId } },
      role: input.role,
      contentMd: input.contentMd,
      citations: input.citations ?? [],
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      durationMs: input.durationMs ?? null,
      dumbMode: input.dumbMode ?? false,
      aborted: input.aborted ?? false,
      metadata: input.metadata ?? Prisma.DbNull,
    };
    if (input.id) data.id = input.id;
    return this.getPrisma().message.create({ data });
  }

  findById(id: string): Promise<Message | null> {
    return this.getPrisma().message.findUnique({ where: { id } });
  }

  listByConversation(conversationId: string): Promise<Message[]> {
    return this.getPrisma().message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
