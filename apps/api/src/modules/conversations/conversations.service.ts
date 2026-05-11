import { AdminUserRepository, ConversationRepository, MessageRepository } from '@mnela/db';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation, Message } from '@prisma/client';

import type { Principal } from '../../auth/types.js';

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly admins: AdminUserRepository,
  ) {}

  async resolveAdminUserId(principal: Principal | undefined): Promise<string> {
    if (principal?.kind === 'admin') return principal.id;
    const fallback = await this.admins.findFirst();
    if (fallback) return fallback.id;
    throw new NotFoundException('No admin user exists yet');
  }

  list(adminUserId: string, page?: number, limit?: number) {
    return this.conversations.listByUser(adminUserId, { page, limit });
  }

  async findById(id: string, adminUserId: string): Promise<ConversationWithMessages> {
    const conversation = await this.conversations.findById(id);
    if (!conversation || conversation.adminUserId !== adminUserId) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    const messages = await this.messages.listByConversation(id);
    return { conversation, messages };
  }

  async rename(id: string, title: string, adminUserId: string): Promise<Conversation> {
    const existing = await this.conversations.findById(id);
    if (!existing || existing.adminUserId !== adminUserId) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return this.conversations.update(id, { title });
  }

  async delete(id: string, adminUserId: string): Promise<{ id: string }> {
    const existing = await this.conversations.findById(id);
    if (!existing || existing.adminUserId !== adminUserId) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    await this.conversations.delete(id);
    return { id };
  }
}
