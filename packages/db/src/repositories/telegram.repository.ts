import { type Prisma } from '@prisma/client';
import type {
  TelegramAllowedUser,
  TelegramBot,
  TelegramChatLink,
  TelegramTransport,
} from '@prisma/client';

import type { PrismaProvider } from './types.js';

export type { TelegramAllowedUser, TelegramBot, TelegramChatLink, TelegramTransport };

const SINGLETON_ID = 'singleton';

export interface UpdateTelegramBotInput {
  enabled?: boolean;
  tokenEnc?: Buffer | null;
  tokenLast4?: string | null;
  botUsername?: string | null;
  botId?: bigint | null;
  transport?: TelegramTransport;
  webhookUrl?: string | null;
  bundleWindowMs?: number;
  defaultProjectSlug?: string | null;
}

/**
 * Singleton-row repository. Every method round-trips the literal
 * `id='singleton'` key — there's no per-id CRUD because there's only one
 * bot per Mnela instance (see ADR-0053). The seed migration inserts the
 * row at install time so callers can rely on `read()` returning non-null.
 */
export class TelegramBotRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  /** Always returns the singleton row, upserting an empty default on miss. */
  async read(): Promise<TelegramBot> {
    const existing = await this.getPrisma().telegramBot.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
    // Seed migration normally creates the row; this branch covers a freshly
    // wiped dev DB where the migration ran but the seed wasn't replayed.
    return this.getPrisma().telegramBot.create({ data: { id: SINGLETON_ID } });
  }

  update(input: UpdateTelegramBotInput): Promise<TelegramBot> {
    const data: Prisma.TelegramBotUpdateInput = {};
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.tokenEnc !== undefined) {
      data.tokenEnc = input.tokenEnc === null ? null : new Uint8Array(input.tokenEnc);
    }
    if (input.tokenLast4 !== undefined) data.tokenLast4 = input.tokenLast4;
    if (input.botUsername !== undefined) data.botUsername = input.botUsername;
    if (input.botId !== undefined) data.botId = input.botId;
    if (input.transport !== undefined) data.transport = input.transport;
    if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl;
    if (input.bundleWindowMs !== undefined) data.bundleWindowMs = input.bundleWindowMs;
    if (input.defaultProjectSlug !== undefined) data.defaultProjectSlug = input.defaultProjectSlug;
    return this.getPrisma().telegramBot.update({ where: { id: SINGLETON_ID }, data });
  }
}

export interface CreateAllowedUserInput {
  tgUserId: bigint;
  label?: string | null;
}

export class TelegramAllowedUserRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  list(): Promise<TelegramAllowedUser[]> {
    return this.getPrisma().telegramAllowedUser.findMany({ orderBy: { createdAt: 'asc' } });
  }

  has(tgUserId: bigint): Promise<TelegramAllowedUser | null> {
    return this.getPrisma().telegramAllowedUser.findUnique({ where: { tgUserId } });
  }

  upsert(input: CreateAllowedUserInput): Promise<TelegramAllowedUser> {
    return this.getPrisma().telegramAllowedUser.upsert({
      where: { tgUserId: input.tgUserId },
      create: { tgUserId: input.tgUserId, label: input.label ?? null },
      update: { label: input.label ?? null },
    });
  }

  async delete(tgUserId: bigint): Promise<boolean> {
    const r = await this.getPrisma().telegramAllowedUser.deleteMany({ where: { tgUserId } });
    return r.count > 0;
  }
}

export interface UpsertChatLinkInput {
  tgChatId: bigint;
  conversationId?: string | null;
  scopeSlug?: string | null;
  lastTurnAt?: Date | null;
}

export class TelegramChatLinkRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  findByChatId(tgChatId: bigint): Promise<TelegramChatLink | null> {
    return this.getPrisma().telegramChatLink.findUnique({ where: { tgChatId } });
  }

  upsert(input: UpsertChatLinkInput): Promise<TelegramChatLink> {
    const create: Prisma.TelegramChatLinkCreateInput = {
      tgChatId: input.tgChatId,
    };
    if (input.conversationId) {
      create.conversation = { connect: { id: input.conversationId } };
    }
    if (input.scopeSlug !== undefined) create.scopeSlug = input.scopeSlug;
    if (input.lastTurnAt !== undefined) create.lastTurnAt = input.lastTurnAt;

    const update: Prisma.TelegramChatLinkUpdateInput = {};
    if (input.conversationId !== undefined) {
      update.conversation = input.conversationId
        ? { connect: { id: input.conversationId } }
        : { disconnect: true };
    }
    if (input.scopeSlug !== undefined) update.scopeSlug = input.scopeSlug;
    if (input.lastTurnAt !== undefined) update.lastTurnAt = input.lastTurnAt;

    return this.getPrisma().telegramChatLink.upsert({
      where: { tgChatId: input.tgChatId },
      create,
      update,
    });
  }

  async clearScope(tgChatId: bigint): Promise<TelegramChatLink | null> {
    const row = await this.findByChatId(tgChatId);
    if (!row) return null;
    return this.getPrisma().telegramChatLink.update({
      where: { tgChatId },
      data: { scopeSlug: null },
    });
  }
}
