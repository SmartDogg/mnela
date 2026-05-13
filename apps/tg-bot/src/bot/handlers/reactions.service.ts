import { Injectable, Logger } from '@nestjs/common';
import type { Api } from 'grammy';

/**
 * Bot reactions are how the bot communicates status without spawning
 * extra messages. Telegram clients show a single emoji bubble next to
 * the user's message; we swap it as the pipeline progresses:
 *
 *   👀  acknowledged
 *   🎧  transcribing voice
 *   📷  analysing photo
 *   ✍️  generating answer
 *   ✅  done
 *   ❌  failed
 *
 * Telegram requires a Premium-eligible emoji set for paid reactions and
 * a different set for standard reactions; the constants below are all
 * available in the free standard set as of Bot API 9.6 (April 2026).
 */

export const REACTION_RECEIVED = '👀';
export const REACTION_TRANSCRIBING = '🎧';
export const REACTION_VISION = '📷';
export const REACTION_THINKING = '✍';
export const REACTION_DONE = '👍';
export const REACTION_ERROR = '🤔';

@Injectable()
export class ReactionsService {
  private readonly logger = new Logger(ReactionsService.name);

  async set(api: Api, chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      await api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji: emoji as never }]);
    } catch (err) {
      this.logger.debug(
        `setMessageReaction failed (chat=${chatId} msg=${messageId} ${emoji}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async clear(api: Api, chatId: number, messageId: number): Promise<void> {
    try {
      await api.setMessageReaction(chatId, messageId, []);
    } catch {
      // ignore — clearing is best-effort
    }
  }
}
