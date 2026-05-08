import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import { loadEnv } from './env.js';
import { McpModule } from './mcp.module.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(McpModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableShutdownHooks();

  await app.listen(env.MCP_HTTP_PORT, '0.0.0.0');

  const logger = app.get(PinoLogger);
  logger.log(`MCP server listening on port ${env.MCP_HTTP_PORT}`);
}

bootstrap().catch((err: unknown) => {
  console.error('fatal: bootstrap failed', err);
  process.exit(1);
});
