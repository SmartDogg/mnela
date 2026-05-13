import { Injectable, Logger } from '@nestjs/common';
import { type TelegramChatLinkRepository } from '@mnela/db';
import type { Bot } from 'grammy';

import { type ConfigService, type ResolvedConfig } from '../../config/config.service.js';
import { type AskRelayService } from './ask-relay.service.js';
import { type CommandsService } from './commands.service.js';
import type { BotHandlersFactory } from './handlers.factory.js';
import { type MediaRouterService } from './media-router.service.js';
import {
  REACTION_RECEIVED,
  REACTION_TRANSCRIBING,
  REACTION_VISION,
  type ReactionsService,
} from './reactions.service.js';
import { type TurnBufferService, type ReadyTurn, type TurnItem } from './turn-buffer.service.js';
import { type WhitelistMiddleware } from './whitelist.middleware.js';

/**
 * Wires the production handler graph onto the grammY Bot instance:
 *
 *   bot.use(whitelist)              ← drops non-whitelisted users
 *   bot.command(...)                ← /scope, /save, /last (CommandsService)
 *   bot.on('message:text', ...)     ← TurnBuffer.add('text')
 *   bot.on('message:voice', ...)    ← TurnBuffer.add('voice') + react 🎧
 *   bot.on('message:photo', ...)    ← TurnBuffer.add('photo') + react 📷
 *   bot.on('message:document', ...) ← TurnBuffer.add('document')
 *   bot.on('message:audio', ...)    ← TurnBuffer.add('audio')
 *
 * The TurnBuffer's `onReady` handler aggregates the items into a single
 * /ask call (MediaRouter handles uploads in parallel; transcripts /
 * vision land via the enrichment pipeline). The AskRelay then streams
 * the answer back via throttled editMessageText.
 *
 * Called once per BotService.reload — handler closures hold the
 * resolved config snapshot, so a reload that flips defaultProjectSlug
 * picks up the new value automatically.
 */
@Injectable()
export class RealHandlersFactory implements BotHandlersFactory {
  private readonly logger = new Logger(RealHandlersFactory.name);

  constructor(
    private readonly whitelist: WhitelistMiddleware,
    private readonly reactions: ReactionsService,
    private readonly turnBuffer: TurnBufferService,
    private readonly mediaRouter: MediaRouterService,
    private readonly askRelay: AskRelayService,
    private readonly commands: CommandsService,
    private readonly chatLinks: TelegramChatLinkRepository,
    private readonly config: ConfigService,
  ) {}

  register(bot: Bot, config: ResolvedConfig): void {
    this.turnBuffer.setBundleWindowMs(config.bundleWindowMs);
    this.turnBuffer.onReady((turn) => this.onTurnReady(bot, turn));
    this.whitelist.resetNotifications();

    // 1. whitelist gate.
    bot.use(this.whitelist.build());

    // 2. commands. Order matters: install BEFORE generic on('message')
    // so command handlers see the update first.
    this.commands.register(bot);

    // 3. media routes — each feeds the TurnBuffer.
    bot.on('message:text', async (ctx) => {
      const msg = ctx.message;
      const text = msg.text;
      if (!text || text.startsWith('/')) return;
      await this.reactions.set(ctx.api, ctx.chat.id, msg.message_id, REACTION_RECEIVED);
      this.turnBuffer.add(ctx.chat.id, ctx.from?.id ?? 0, {
        kind: 'text',
        msgId: msg.message_id,
        text,
      });
    });

    bot.on('message:voice', async (ctx) => {
      const msg = ctx.message;
      await this.reactions.set(ctx.api, ctx.chat.id, msg.message_id, REACTION_TRANSCRIBING);
      const item: TurnItem = {
        kind: 'voice',
        msgId: msg.message_id,
        fileId: msg.voice.file_id,
        mime: msg.voice.mime_type ?? 'audio/ogg',
        filename: `voice-${msg.message_id}.ogg`,
      };
      if (msg.caption) item.text = msg.caption;
      this.turnBuffer.add(ctx.chat.id, ctx.from?.id ?? 0, item);
    });

    bot.on('message:photo', async (ctx) => {
      const msg = ctx.message;
      const photos = msg.photo;
      const largest = photos[photos.length - 1];
      if (!largest) return;
      await this.reactions.set(ctx.api, ctx.chat.id, msg.message_id, REACTION_VISION);
      const item: TurnItem = {
        kind: 'photo',
        msgId: msg.message_id,
        fileId: largest.file_id,
        mime: 'image/jpeg',
        filename: `photo-${msg.message_id}.jpg`,
      };
      if (msg.caption) item.text = msg.caption;
      this.turnBuffer.add(ctx.chat.id, ctx.from?.id ?? 0, item);
    });

    bot.on('message:document', async (ctx) => {
      const msg = ctx.message;
      await this.reactions.set(ctx.api, ctx.chat.id, msg.message_id, REACTION_RECEIVED);
      const item: TurnItem = {
        kind: 'document',
        msgId: msg.message_id,
        fileId: msg.document.file_id,
        filename: msg.document.file_name ?? `doc-${msg.message_id}.bin`,
      };
      if (msg.document.mime_type) item.mime = msg.document.mime_type;
      if (msg.caption) item.text = msg.caption;
      this.turnBuffer.add(ctx.chat.id, ctx.from?.id ?? 0, item);
    });

    bot.on('message:audio', async (ctx) => {
      const msg = ctx.message;
      await this.reactions.set(ctx.api, ctx.chat.id, msg.message_id, REACTION_TRANSCRIBING);
      const item: TurnItem = {
        kind: 'audio',
        msgId: msg.message_id,
        fileId: msg.audio.file_id,
        filename: msg.audio.file_name ?? `audio-${msg.message_id}.mp3`,
      };
      if (msg.audio.mime_type) item.mime = msg.audio.mime_type;
      if (msg.caption) item.text = msg.caption;
      this.turnBuffer.add(ctx.chat.id, ctx.from?.id ?? 0, item);
    });
  }

  private async onTurnReady(bot: Bot, turn: ReadyTurn): Promise<void> {
    this.logger.log(
      `turn ready chat=${turn.chatId} turn=${turn.turnId} items=${turn.items.length}`,
    );
    const primaryMsgId = turn.items[0]?.msgId ?? 0;

    // Upload media items in parallel — fire-and-forget; we don't block
    // the /ask call on enrichment finishing, the LLM gets the user's
    // intent from text + captions and the media flows into the vault
    // for next time.
    const mediaItems = turn.items.filter((it) => it.fileId);
    if (mediaItems.length > 0) {
      const link = await this.chatLinks.findByChatId(BigInt(turn.chatId)).catch(() => null);
      const resolved = await this.config.resolve();
      const scope: string | null = link?.scopeSlug ?? resolved.defaultProjectSlug;
      await Promise.all(
        mediaItems.map((it) =>
          this.mediaRouter.ingest(bot.api, it, {
            chatId: turn.chatId,
            userId: turn.userId,
            turnId: turn.turnId,
            scopeSlug: scope,
          }),
        ),
      );
    }

    const composedText = this.composeQuery(turn);
    if (composedText.trim().length === 0) {
      // Pure media drop with no captions — acknowledge with a short
      // confirmation and skip /ask. The vault already has the bytes.
      await bot.api
        .sendMessage(
          turn.chatId,
          `📥 Принял ${turn.items.length} файлов в базу. Спроси что-нибудь, когда будет нужно.`,
          { reply_parameters: { message_id: primaryMsgId, allow_sending_without_reply: true } },
        )
        .catch(() => undefined);
      return;
    }

    await this.askRelay.streamTurn(bot.api, turn, composedText, primaryMsgId);
  }

  private composeQuery(turn: ReadyTurn): string {
    const parts: string[] = [];
    for (const item of turn.items) {
      if (item.kind === 'text' && item.text) parts.push(item.text);
      else if (item.text) parts.push(`[${item.kind} caption] ${item.text}`);
      else if (item.kind === 'voice') parts.push(`[голосовое сообщение — расшифровка в базе]`);
      else if (item.kind === 'photo') parts.push(`[фото — описание в базе]`);
      else if (item.kind === 'document') parts.push(`[документ ${item.filename ?? ''} — в базе]`);
      else if (item.kind === 'audio') parts.push(`[аудиозапись — расшифровка в базе]`);
    }
    return parts.join('\n').trim();
  }
}
