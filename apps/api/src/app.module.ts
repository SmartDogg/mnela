import { Module } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './env.js';
import { DailyModule } from './modules/daily/daily.module.js';
import { DecisionsModule } from './modules/decisions/decisions.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { InboxModule } from './modules/inbox/inbox.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { PrismaModule } from './prisma.module.js';
import { RedisModule } from './redis.module.js';
import { RepositoriesModule } from './repositories.module.js';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.MNELA_LOG_LEVEL,
        transport:
          env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          remove: true,
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/system/health',
        },
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
      },
    ]),
    PrismaModule,
    RedisModule,
    RepositoriesModule,
    AuditModule,
    AuthModule,
    DailyModule,
    DecisionsModule,
    DocumentsModule,
    GraphModule,
    ImportsModule,
    InboxModule,
    JobsModule,
    ProjectsModule,
    SearchModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
