import { Injectable, Logger } from '@nestjs/common';
import type { Context, NextFunction } from 'grammy';

import { type ConfigService } from '../../config/config.service.js';

/**
 * Bot-wide gate. Drops messages from non-whitelisted users with at most
 * one "not authorized" reply per chat (so first-contact gets context;
 * subsequent spam is silent). Commands (incl. /start) bypass the gate —
 * /start is the explicit "I'm here, am I allowed?" probe and BotService
 * handles its own response based on whitelist membership.
 */
@Injectable()
export class WhitelistMiddleware {
  private readonly logger = new Logger(WhitelistMiddleware.name);
  private readonly notifiedChats = new Set<number>();

  constructor(private readonly config: ConfigService) {}

  build() {
    return async (ctx: Context, next: NextFunction): Promise<void> => {
      // Commands always pass — /start needs to land in BotService even
      // when the sender isn't whitelisted yet.
      if (ctx.message?.text?.startsWith('/')) {
        await next();
        return;
      }
      const userId = ctx.from?.id;
      if (!userId) {
        return; // service/anonymous messages
      }
      const allowed = await this.config.isAllowed(BigInt(userId));
      if (allowed) {
        await next();
        return;
      }
      const chatId = ctx.chat?.id;
      if (chatId && !this.notifiedChats.has(chatId)) {
        this.notifiedChats.add(chatId);
        await ctx
          .reply(
            `❌ Не авторизован.\nuser_id: ${userId}\n\n` +
              'Добавьте этот id в /admin/system → Telegram → whitelist и попробуйте снова.',
          )
          .catch(() => undefined);
      }
      this.logger.debug(`dropped update from non-whitelisted user_id=${userId}`);
    };
  }

  /** Called by ReloadService after a whitelist change so the soft
   * notification reactivates for users that previously got rejected
   * (they may have just been added). */
  resetNotifications(): void {
    this.notifiedChats.clear();
  }
}
