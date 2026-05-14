import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';
import { ProblemDetailsFilter } from './filters/problem-details.filter.js';
import { maintenanceMiddleware } from './middleware/maintenance.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  app.use(helmet({ contentSecurityPolicy: false }));
  // Maintenance gate must run before cookieParser so even unauthenticated
  // calls receive a clean 503 during restore.
  app.use(maintenanceMiddleware);
  app.use(cookieParser(env.COOKIE_SECRET));

  app.setGlobalPrefix('api/v1', { exclude: ['api/docs', 'api/docs-json'] });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mnela API')
    .setDescription('Self-hosted personal second brain — REST API')
    .setVersion('1.0.0')
    .addCookieAuth('mnela_session')
    .addBearerAuth({ type: 'http', scheme: 'bearer' })
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDoc, {
    jsonDocumentUrl: 'api/docs-json',
  });

  await app.listen(env.HTTP_PORT, env.HTTP_HOST);
  const logger = app.get(PinoLogger);
  logger.log(`mnela api listening on http://${env.HTTP_HOST}:${env.HTTP_PORT}`);
  logger.log(`swagger ui available at http://${env.HTTP_HOST}:${env.HTTP_PORT}/api/docs`);
}

bootstrap().catch((err: unknown) => {
  console.error('fatal: bootstrap failed', err);
  process.exit(1);
});
