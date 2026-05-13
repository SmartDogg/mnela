import { Injectable, Logger } from '@nestjs/common';
import { type TelegramChatLinkRepository } from '@mnela/db';
import type { Api } from 'grammy';

import { type ApiClientService } from '../../api-client/api-client.service.js';
import { type ConfigService } from '../../config/config.service.js';
import {
  REACTION_DONE,
  REACTION_ERROR,
  REACTION_THINKING,
  type ReactionsService,
} from './reactions.service.js';
import type { ReadyTurn } from './turn-buffer.service.js';

interface AskFrame {
  event: string;
  data: unknown;
}

interface MetaPayload {
  conversationId?: string;
  dumbMode?: boolean;
  providerName?: string;
}

interface TokenPayload {
  delta?: string;
}

interface CitationPayload {
  docId?: string;
  title?: string;
}

interface DonePayload {
  conversationId?: string;
  messageId?: string;
}

interface ErrorPayload {
  reason?: string;
  message?: string;
}

/**
 * Streams /search/ask back to Telegram. Strategy:
 *
 *  1. Resolve (or create) the chat's Conversation via TelegramChatLink.
 *  2. POST /search/ask with `query` = composed turn text,
 *     `conversationId` = the link's id, `scopeProjectSlug` = the link's
 *     scopeSlug (falling back to the bot's defaultProjectSlug).
 *  3. As `token` frames arrive, accumulate into a debounced editMessage
 *     stream. Telegram's Bot API 9.5 `sendMessageDraft` would be the
 *     ideal "native typing" surface but is not yet exposed by grammY —
 *     we fall back to `sendMessage` + throttled `editMessageText` at ≤1
 *     edit/second to stay inside flood limits. ADR-0053 flags this as a
 *     planned upgrade once grammY adds `sendMessageDraft` support.
 *  4. Append a citations footer if any docs were cited.
 *  5. React ✍️ while streaming, ✅ on done, 🤔 on error.
 */
@Injectable()
export class AskRelayService {
  private readonly logger = new Logger(AskRelayService.name);
  /**
   * Min interval between `editMessageText` calls per message. Telegram's
   * Bot API documents ~30 edits/sec globally and undocumented stricter
   * per-message bucket (~5/min sustained). 500 ms keeps us safely inside
   * both while still showing real typing cadence — users see ~2 updates
   * per second. Bot API 9.5 added `sendMessageDraft` for native partial-
   * message streaming, but grammY 1.36 doesn't expose it as a first-
   * class method yet — when it does, swap the throttle for the draft
   * stream and the UX gets noticeably smoother.
   */
  private readonly THROTTLE_MS = 500;
  private readonly MAX_TG_MESSAGE = 4000;

  constructor(
    private readonly api: ApiClientService,
    private readonly chatLinks: TelegramChatLinkRepository,
    private readonly config: ConfigService,
    private readonly reactions: ReactionsService,
  ) {}

  async streamTurn(api: Api, turn: ReadyTurn, query: string, primaryMsgId: number): Promise<void> {
    if (query.trim().length === 0) {
      this.logger.warn(`empty query for chat=${turn.chatId} turn=${turn.turnId}; skipping ask`);
      return;
    }
    const resolved = await this.config.resolve();
    const link = await this.chatLinks.findByChatId(BigInt(turn.chatId));
    const scopeSlug = link?.scopeSlug ?? resolved.defaultProjectSlug;

    await this.reactions.set(api, turn.chatId, primaryMsgId, REACTION_THINKING);

    const placeholder = await api.sendMessage(turn.chatId, '…', {
      reply_parameters: { message_id: primaryMsgId, allow_sending_without_reply: true },
    });

    const citations: { docId: string; title: string }[] = [];
    let buffer = '';
    let lastEditAt = 0;
    let lastSent = '…';

    const flushEdit = async (final = false): Promise<void> => {
      const text = this.format(buffer, citations);
      if (text === lastSent) return;
      if (!final && Date.now() - lastEditAt < this.THROTTLE_MS) return;
      lastSent = text;
      lastEditAt = Date.now();
      try {
        await api.editMessageText(turn.chatId, placeholder.message_id, text || '…', {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        // Telegram rejects identical-content edits with 400; treat as no-op.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('message is not modified')) {
          this.logger.debug(`editMessageText failed: ${msg}`);
        }
      }
    };

    let conversationIdFromMeta: string | undefined;
    let ok = false;
    let errorText: string | null = null;
    const askBody: Parameters<typeof this.api.askStream>[0] = { query, kind: 'chat' };
    if (link?.conversationId) askBody.conversationId = link.conversationId;
    if (scopeSlug) askBody.scopeProjectSlug = scopeSlug;

    try {
      for await (const frame of this.api.askStream(askBody)) {
        const { event, data } = frame as AskFrame;
        switch (event) {
          case 'meta': {
            conversationIdFromMeta = (data as MetaPayload).conversationId;
            break;
          }
          case 'token': {
            const delta = (data as TokenPayload).delta ?? '';
            if (delta) {
              buffer += delta;
              if (buffer.length > this.MAX_TG_MESSAGE) {
                buffer = buffer.slice(0, this.MAX_TG_MESSAGE) + '…';
              }
              await flushEdit();
            }
            break;
          }
          case 'citation': {
            const c = data as CitationPayload;
            if (c.docId && c.title) {
              if (!citations.some((x) => x.docId === c.docId)) {
                citations.push({ docId: c.docId, title: c.title });
              }
            }
            break;
          }
          case 'done': {
            ok = true;
            conversationIdFromMeta = (data as DonePayload).conversationId ?? conversationIdFromMeta;
            break;
          }
          case 'error': {
            const e = data as ErrorPayload;
            errorText = e.message ?? e.reason ?? 'failed';
            break;
          }
        }
      }
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    }

    if (conversationIdFromMeta) {
      await this.chatLinks
        .upsert({
          tgChatId: BigInt(turn.chatId),
          conversationId: conversationIdFromMeta,
          lastTurnAt: new Date(),
        })
        .catch(() => undefined);
    }

    if (!ok && errorText) {
      buffer = buffer + (buffer ? '\n\n' : '') + `❌ ${this.escapeHtml(errorText)}`;
    }
    await flushEdit(true);

    await this.reactions.set(api, turn.chatId, primaryMsgId, ok ? REACTION_DONE : REACTION_ERROR);
  }

  private format(body: string, citations: { docId: string; title: string }[]): string {
    const safeBody = this.escapeHtml(body);
    if (citations.length === 0) return safeBody;
    const footer = citations
      .slice(0, 6)
      .map((c, i) => `<i>[${i + 1}] ${this.escapeHtml(c.title)}</i>`)
      .join('\n');
    return `${safeBody}\n\n${footer}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
  }
}
