/**
 * BotService — owns the grammY Bot instance lifecycle.
 *
 * On boot: reads config; if `enabled && token` starts long-polling.
 * On `system.telegram_reload`: gracefully stops the current bot, re-reads
 * config, and starts again. The whole loop is single-flight (`reloading`
 * guard) so back-to-back PATCHes don't race.
 *
 * The actual message handling lives in handlers/* — this service just
 * wires the lifecycle and the always-on /start command so users see a
 * friendly response the very first time they interact.
 *
 * Streaming (sendMessageDraft, Bot API 9.5) and multi-modal turn
 * bundling are layered on top via the TurnBuffer + AskRelay services
 * registered in subsequent ADR-0053 tasks.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Bot, GrammyError, HttpError } from 'grammy';

import { ConfigService, type ResolvedConfig } from '../config/config.service.js';
import type { BotHandlersFactory } from './handlers/handlers.factory.js';
import { HANDLERS_FACTORY } from './handlers/handlers.token.js';

export interface BotIdentity {
  id: number;
  username?: string;
  first_name: string;
}

@Injectable()
export class BotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot | null = null;
  private reloading = false;
  private pendingReload = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(HANDLERS_FACTORY) private readonly handlersFactory: BotHandlersFactory,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reload('boot').catch((err) => {
      this.logger.error(
        `initial reload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async reload(reason: string): Promise<void> {
    if (this.reloading) {
      // Coalesce a burst of PATCHes — the in-flight reload will pick up
      // the latest config once it finishes.
      this.pendingReload = true;
      this.logger.debug(`reload (${reason}) coalesced into in-flight reload`);
      return;
    }
    this.reloading = true;
    try {
      do {
        this.pendingReload = false;
        await this.applyConfig(reason);
      } while (this.pendingReload);
    } finally {
      this.reloading = false;
    }
  }

  private async applyConfig(reason: string): Promise<void> {
    const config = await this.config.resolve();
    await this.stop();

    if (!config.enabled) {
      this.logger.log(`telegram disabled (reason=${reason}); bot idle`);
      return;
    }
    if (!config.token) {
      this.logger.warn(`telegram enabled but no token configured; bot idle`);
      return;
    }
    if (config.transport === 'webhook') {
      // Webhook transport requires an HTTPS endpoint we don't own here;
      // surface and continue. Documented as an advanced setup in ADR-0053.
      this.logger.warn(
        `telegram transport=webhook is not yet auto-served by tg-bot — set up an external HTTPS proxy that forwards POST to grammY's webhookCallback, or switch to polling.`,
      );
      return;
    }

    const bot = new Bot(config.token);
    this.installHandlers(bot, config);
    this.installErrorBoundary(bot);

    // Fire-and-forget; grammY's `start()` resolves only when the bot stops.
    void bot
      .start({
        drop_pending_updates: false,
        onStart: (info) => {
          this.logger.log(`tg-bot started: @${info.username} (id=${info.id}) reason=${reason}`);
        },
      })
      .catch((err) => {
        this.logger.error(
          `bot.start() rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    this.bot = bot;
  }

  private async stop(): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.stop();
      this.logger.debug('previous bot instance stopped');
    } catch (err) {
      this.logger.warn(`bot.stop() failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.bot = null;
    }
  }

  private installHandlers(bot: Bot, config: ResolvedConfig): void {
    // /start is always available — even when the user isn't whitelisted,
    // so the bot can explain what's going on instead of dropping silently.
    bot.command('start', async (ctx) => {
      const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
      const allowed = userId !== null ? await this.config.isAllowed(userId) : false;
      const username = config.botUsername ?? 'this bot';
      if (allowed) {
        await ctx.reply(
          `Привет! Я Mnela-бот @${username}.\n\n` +
            'Просто напиши вопрос — я найду ответ в твоей базе знаний.\n' +
            'Команды:\n' +
            '/save <текст> — сохранить заметку без LLM\n' +
            '/scope <slug> — ограничить чат проектом\n' +
            '/last [N] — показать последние документы',
        );
      } else {
        const idText = ctx.from?.id ? `\nuser_id: ${ctx.from.id}` : '';
        await ctx.reply(
          `❌ Не авторизован.${idText}\n\n` +
            'Этот бот — приватный second-brain. Если вы владелец, добавьте этот user_id в /admin/system → Telegram → whitelist.',
        );
      }
    });

    this.handlersFactory.register(bot, config);
  }

  private installErrorBoundary(bot: Bot): void {
    bot.catch((err) => {
      const ctx = err.ctx;
      const update = ctx.update.update_id;
      if (err.error instanceof GrammyError) {
        this.logger.warn(`grammy api error u=${update} d=${err.error.description}`);
      } else if (err.error instanceof HttpError) {
        this.logger.warn(`grammy http error u=${update} m=${err.error.message}`);
      } else {
        this.logger.error(
          `grammy unhandled u=${update}: ${err.error instanceof Error ? err.error.message : String(err.error)}`,
        );
      }
    });
  }
}
