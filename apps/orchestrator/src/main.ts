import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { OrchestratorModule } from './orchestrator.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(OrchestratorModule, { bufferLogs: true });
  const logger = new Logger('orchestrator');
  app.enableShutdownHooks();
  logger.log('mnela orchestrator started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('orchestrator failed to start:', err);
  process.exit(1);
});
