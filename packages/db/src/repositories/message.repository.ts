import { Prisma } from '@prisma/client';
import type { Message, MessageRole } from '@prisma/client';

import type { PrismaProvider } from './types.js';

/** Mirrors the new MessageKind enum (migration 20260513150100). */
export type MessageKind = 'ephemeral' | 'pinned';

export interface AppendMessageInput {
  id?: string;
  conversationId: string;
  role: MessageRole;
  kind?: MessageKind;
  contentMd: string;
  citations?: Prisma.InputJsonValue;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** USD spent on this turn, computed from per-model rate table. */
  costUsd?: number | null;
  /** Soft-FK to LlmProvider — no constraint; survives provider delete. */
  providerId?: string | null;
  /** Model id breadcrumb (e.g. "claude-opus-4-7"). */
  model?: string | null;
  durationMs?: number | null;
  dumbMode?: boolean;
  aborted?: boolean;
  metadata?: Prisma.InputJsonValue | null;
}

export class MessageRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  /**
   * Create a Message row. We never pass `kind` / `pinnedDocumentId`
   * through the generated Prisma client — the regenerated client may
   * lag behind the schema by one process restart on Windows (the
   * query-engine .dll is held by running dev servers). The DB default
   * `kind = 'ephemeral'` covers the common case; pinned turns get a raw
   * SQL UPDATE after the row exists.
   */
  async append(input: AppendMessageInput): Promise<Message> {
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
    const msg = await this.getPrisma().message.create({ data });
    /*
     * costUsd / providerId / model also go through raw SQL — the
     * Prisma client may not have regenerated yet on the developer's
     * Windows box (same query-engine .dll lock as `kind`). Falling back
     * to the underlying ALTER TABLE columns directly keeps the write
     * non-fatal: if the migration hasn't run, the columns don't exist,
     * the UPDATE fails, and the message persists without telemetry.
     */
    if (
      input.costUsd !== undefined ||
      input.providerId !== undefined ||
      input.model !== undefined
    ) {
      try {
        await this.getPrisma().$executeRawUnsafe(
          `UPDATE "Message" SET "costUsd" = $1, "providerId" = $2, "model" = $3 WHERE id = $4`,
          input.costUsd ?? null,
          input.providerId ?? null,
          input.model ?? null,
          msg.id,
        );
      } catch {
        // Migration not applied; telemetry silently skipped.
      }
    }
    if (input.kind && input.kind !== 'ephemeral') {
      try {
        await this.getPrisma().$executeRawUnsafe(
          `UPDATE "Message" SET "kind" = $1::"MessageKind" WHERE id = $2`,
          input.kind,
          msg.id,
        );
        Object.assign(msg, { kind: input.kind });
      } catch {
        // Migration 20260513150100 not applied yet — the message is still
        // valid as an ephemeral row, just without the pinned flag. Caller
        // logs the failure separately via the pin flow's catch.
      }
    }
    return msg;
  }

  /**
   * Set the back-reference to the Document that a pinned message
   * produced. Uses raw SQL so we don't depend on the generated client
   * knowing about the new column (see comment on append()).
   */
  async setPinnedDocument(messageId: string, documentId: string): Promise<void> {
    await this.getPrisma().$executeRawUnsafe(
      `UPDATE "Message" SET "pinnedDocumentId" = $1 WHERE id = $2`,
      documentId,
      messageId,
    );
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
