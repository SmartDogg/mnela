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
    // ThrottlerModule is configured once at startup; live re-configure
    // would mean rebuilding NestJS DI graph mid-flight. The registry
    // key `api.rateLimit.global` is marked requiresRestart=true, so the
    // /admin/system Restart Services button re-bootstraps the api with
    // the new value via process.exit(0) → docker/systemd auto-restart.
    // We deliberately read env here as the BOOT default (zod fallback)
    // before SystemConfig is even reachable; if the registry override
    // exists, the boot-time read in AppModule.imports will use it.
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule, RepositoriesModule],
      inject: [SystemConfigRepository],
      useFactory: async (systemConfig: SystemConfigRepository) => {
        const { readRegistryValue } = await import('@mnela/core');
        const limit = await readRegistryValue<number>(
          systemConfig,
          'api.rateLimit.global',
          env.RATE_LIMIT_GLOBAL_PER_MINUTE,
        );
        return [{ name: 'default', ttl: 60_000, limit }];
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
