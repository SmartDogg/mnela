import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { initSentry, startHeartbeat } from '@mnela/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { OrchestratorModule } from './orchestrator.module.js';

async function bootstrap(): Promise<void> {
  await initSentry({ serviceName: 'orchestrator' });
  const app = await NestFactory.createApplicationContext(OrchestratorModule, { bufferLogs: true });
  // Same pattern the api uses: bufferLogs=true + useLogger(pino) flushes
  // anything Nest queued during module init through pino. Without this, the
  // pre-existing main.ts swallowed every log line — including the very
  // useful "worker ready" / "enrichment job N failed" entries.
  app.useLogger(app.get(PinoLogger));
  const logger = new Logger('orchestrator');
  app.enableShutdownHooks();
  logger.log('mnela orchestrator started');

  const stopHeartbeat = startHeartbeat();

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, shutting down`);
    stopHeartbeat();
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
