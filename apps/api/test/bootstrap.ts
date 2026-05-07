import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';

import { loadEnv, resetEnvCache } from '../src/env.js';
import { ProblemDetailsFilter } from '../src/filters/problem-details.filter.js';

export async function buildTestApp(): Promise<INestApplication> {
  resetEnvCache();
  const env = loadEnv();
  // Lazy-import AppModule so loadEnv() at its top level sees the env vars set
  // by the testcontainers setup (which runs in a beforeAll).
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}
