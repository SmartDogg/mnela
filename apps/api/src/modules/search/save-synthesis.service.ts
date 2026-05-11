import { createHash } from 'node:crypto';

import {
  AuditLogRepository,
  ConversationRepository,
  DocumentRepository,
  MessageRepository,
  PrismaService,
} from '@mnela/db';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { Principal } from '../../auth/types.js';
import { ConversationsService } from '../conversations/conversations.service.js';

export interface SaveSynthesisInput {
  conversationId: string;
  messageId: string;
  title?: string;
  principal: Principal | undefined;
}

interface PersistedCitation {
  ord: number;
  docId: string;
  snippet: string;
  title: string | null;
}

@Injectable()
export class SaveSynthesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly documents: DocumentRepository,
    private readonly audit: AuditLogRepository,
    private readonly conversationsService: ConversationsService,
  ) {}

  async run(input: SaveSynthesisInput): Promise<{ documentId: string; conversationId: string }> {
    const adminUserId = await this.conversationsService.resolveAdminUserId(input.principal);
    const conv = await this.conversations.findById(input.conversationId);
    if (!conv || conv.adminUserId !== adminUserId) {
      throw new NotFoundException(`Conversation ${input.conversationId} not found`);
    }
    const message = await this.messages.findById(input.messageId);
    if (!message || message.conversationId !== conv.id) {
      throw new NotFoundException(`Message ${input.messageId} not found`);
    }
    if (message.role !== 'assistant') {
      throw new BadRequestException('Only assistant messages can be saved as synthesis');
    }
    if (message.contentMd.trim().length === 0) {
      throw new BadRequestException('Empty messages cannot become a synthesis');
    }

    const title = (input.title ?? conv.title).trim();
    const citations = (message.citations ?? []) as unknown as PersistedCitation[];
    const docIds = Array.from(new Set(citations.map((c) => c.docId)));
    const contentHash = createHash('sha256')
      .update(`synthesis::${conv.id}::${message.id}::${message.contentMd}`)
      .digest('hex');

    const metadata = {
      synthesizedFromConversationId: conv.id,
      synthesizedFromMessageId: message.id,
      citedDocumentIds: docIds,
      citations: citations.map((c) => ({
        ord: c.ord,
        docId: c.docId,
        snippet: c.snippet,
      })),
    } as unknown as Prisma.InputJsonValue;

    return this.prisma.runInTx(async () => {
      const existingByHash = await this.documents.findByContentHash(contentHash);
      if (existingByHash) {
        return { documentId: existingByHash.id, conversationId: conv.id };
      }
      const doc = await this.documents.create({
        source: 'manual_upload',
        title,
        rawText: message.contentMd,
        contentHash,
        type: 'synthesis',
        status: 'enriched',
        language: detectLanguage(message.contentMd),
        metadata,
      });
      await this.conversations.update(conv.id, { synthesisDocumentId: doc.id });
      await this.audit.create({
        action: 'ask.save_synthesis',
        actor: 'system:api',
        targetType: 'Document',
        targetId: doc.id,
        metadata: {
          conversationId: conv.id,
          messageId: message.id,
          citationsTotal: citations.length,
        } as Prisma.InputJsonValue,
      });
      return { documentId: doc.id, conversationId: conv.id };
    });
  }
}

function detectLanguage(text: string): string {
  const cyrillicCount = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillicCount > latinCount * 0.3) return 'ru';
  if (latinCount > cyrillicCount * 0.3) return 'en';
  return 'mixed';
}
