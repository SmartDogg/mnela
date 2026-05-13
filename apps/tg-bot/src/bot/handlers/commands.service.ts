import { Injectable, Logger } from '@nestjs/common';
import { type TelegramChatLinkRepository } from '@mnela/db';
import type { Bot } from 'grammy';

import { type ApiClientService } from '../../api-client/api-client.service.js';
import { type ConfigService } from '../../config/config.service.js';

/**
 * Explicit command surface. Three commands, each opting into behaviour
 * that would otherwise be ambiguous from raw text:
 *
 *   /scope <slug>   — sticky project filter for this chat
 *   /save <text>    — force-ingest (no LLM agent loop)
 *   /last [N]       — list the bot's recent ingests
 */
@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);

  constructor(
    private readonly api: ApiClientService,
    private readonly chatLinks: TelegramChatLinkRepository,
    private readonly config: ConfigService,
  ) {}

  register(bot: Bot): void {
    bot.command('scope', async (ctx) => {
      const arg = (ctx.match ?? '').trim();
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      if (arg.length === 0) {
        await this.chatLinks.clearScope(BigInt(chatId));
        await ctx.reply('🧭 Scope сброшен. Поиск по всей базе.');
        return;
      }
      const slug = arg.replace(/^project:/, '').toLowerCase();
      await this.chatLinks.upsert({ tgChatId: BigInt(chatId), scopeSlug: slug });
      await ctx.reply(
        `🧭 Scope: <code>${slug}</code>. /ask и сохранения теперь ограничены этим проектом.`,
        {
          parse_mode: 'HTML',
        },
      );
    });

    bot.command('save', async (ctx) => {
      const content = (ctx.match ?? '').trim();
      if (content.length === 0) {
        await ctx.reply('Использование: <code>/save Заметка которую нужно запомнить</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id;
      const msgId = ctx.message?.message_id;
      const resolved = await this.config.resolve();
      const link = chatId ? await this.chatLinks.findByChatId(BigInt(chatId)) : null;
      const scopeSlug = link?.scopeSlug ?? resolved.defaultProjectSlug;
      try {
        const noteInput: Parameters<typeof this.api.saveNote>[0] = {
          content,
          source: 'telegram',
          metadata: {
            telegram: {
              chatId,
              msgId,
              userId,
            },
          },
        };
        if (scopeSlug) noteInput.projects = [scopeSlug];
        const res = await this.api.saveNote(noteInput);
        await ctx.reply(
          `📝 Принято в очередь (job <code>${res.jobId}</code>)${scopeSlug ? ` в <i>${scopeSlug}</i>` : ''}. Документ материализуется через несколько секунд.`,
          { parse_mode: 'HTML' },
        );
      } catch (err) {
        this.logger.error(`/save failed: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply('❌ Не удалось сохранить. Подробности в логах.');
      }
    });

    bot.command('last', async (ctx) => {
      const arg = (ctx.match ?? '').trim();
      const limit = arg.length > 0 && /^\d+$/.test(arg) ? Math.min(Number(arg), 25) : 10;
      try {
        const items = await this.api.recentActivity({ limit, source: 'telegram' });
        if (items.length === 0) {
          await ctx.reply('История пуста — этот бот ещё ничего не сохранил.');
          return;
        }
        const lines = items
          .map((d, i) => `${i + 1}. ${this.shorten(d.title, 60)} — <code>${d.id}</code>`)
          .join('\n');
        await ctx.reply(`Последние ${items.length}:\n${lines}`, { parse_mode: 'HTML' });
      } catch (err) {
        this.logger.error(`/last failed: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply('❌ Не удалось получить ленту.');
      }
    });
  }

  private shorten(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }
}
