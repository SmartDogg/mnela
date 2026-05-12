import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  // `bufferLogs: true` keeps all Nest startup logs invisible under
  // turbo+node-watch on Windows (turbo's stdout aggregator never sees the
  // flush). Drop it so the dev stack actually surfaces "watching ...",
  // "ingestion worker ready", and per-job parser logs when something
  // misbehaves.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('worker');
  app.enableShutdownHooks();
  logger.log('mnela worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('worker failed to start:', err);
  process.exit(1);
});
