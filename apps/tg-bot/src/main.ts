import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { initSentry, startHeartbeat } from '@mnela/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { loadEnv } from './env.js';
import { TgBotModule } from './tg-bot.module.js';

/**
 * apps/tg-bot — Telegram-bot frontend over /search/ask + /documents/upload.
 *
 * Headless NestJS process: there's no HTTP server, just the BotService
 * long-polling Telegram (or, when configured, receiving webhook updates)
 * and the ReloadService listening for `system.telegram_reload` on the
 * shared Redis pubsub. See ADR-0053.
 */
async function bootstrap(): Promise<void> {
  loadEnv();
  await initSentry({ serviceName: 'tg-bot' });
  const app = await NestFactory.createApplicationContext(TgBotModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const stopHeartbeat = startHeartbeat();

  // Keep the process alive even when the bot is disabled — the
  // ReloadService still listens for config flips so toggling Enabled in
  // /admin/system starts the bot without a restart.
  const shutdown = async (): Promise<void> => {
    stopHeartbeat();
    await app.close();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  const logger = app.get(PinoLogger);
  logger.log('tg-bot process started; awaiting config…');
}

bootstrap().catch((err: unknown) => {
  console.error('fatal: tg-bot bootstrap failed', err);
  process.exit(1);
});
