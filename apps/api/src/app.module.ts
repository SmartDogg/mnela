import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './env.js';
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
    SystemModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }, ThrottlerGuard],
})
export class AppModule {}
