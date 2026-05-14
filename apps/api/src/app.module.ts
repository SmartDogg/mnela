import { Module } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './env.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { DecisionsModule } from './modules/decisions/decisions.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { InboxModule } from './modules/inbox/inbox.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { LiveModule } from './live/live.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { TelegramModule } from './modules/telegram/telegram.module.js';
import { rateLimitHolder } from './modules/system/rate-limit.holder.js';
import { PrismaModule, RepositoriesModule, SystemConfigRepository } from '@mnela/db';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis.module.js';

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
    // ThrottlerModule is configured once at NestJS DI-graph construction,
    // but `limit` accepts a `Resolvable<number> = number | ((ctx) =>
    // Promise<number>)` — we pass a function backed by `rateLimitHolder`
    // (10s in-memory cache, invalidated by RateLimitReloadBoot on
    // service_reload). Net effect: changes to `api.rateLimit.global` /
    // `api.rateLimit.login` from /admin/system take effect on the next
    // inbound request, no process restart required.
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule, RepositoriesModule],
      inject: [SystemConfigRepository],
      useFactory: (systemConfig: SystemConfigRepository) => {
        rateLimitHolder.bind(systemConfig);
        return [
          {
            name: 'default',
            ttl: 60_000,
            limit: () => rateLimitHolder.getGlobal(),
          },
        ];
      },
    }),
    PrismaModule,
    QueueModule,
    RedisModule,
    RepositoriesModule,
    AuditModule,
    AuthModule,
    ConversationsModule,
    DecisionsModule,
    DocumentsModule,
    GraphModule,
    ImportsModule,
    InboxModule,
    JobsModule,
    LiveModule,
    ProjectsModule,
    ProvidersModule,
    SearchModule,
    SystemModule,
    TelegramModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
