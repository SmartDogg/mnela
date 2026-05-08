import { Inject, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { PrismaModule, RepositoriesModule } from '@mnela/db';
import type { NextFunction, Request, Response } from 'express';
import { LoggerModule } from 'nestjs-pino';

import { AuthService } from './auth/auth.service.js';
import { runAuth } from './auth/auth.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './env.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';
import { TransportModule } from './transport/transport.module.js';

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
          ignore: (req) => req.url === '/health',
        },
      },
    }),
    PrismaModule,
    RepositoriesModule,
    RedisModule,
    QueueModule,
    AuthModule,
    HealthModule,
    TransportModule,
  ],
})
export class McpModule implements NestModule {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  // Bearer auth applies only to the JSON-RPC surface; /health stays open so
  // container probes don't need credentials. ADR-0033: per-call DB verify.
  // Class-based NestMiddleware DI is brittle in some bundler/loader combos
  // (esp. when other modules also configure middleware) — bind functional
  // middleware here with the resolved AuthService captured at module init.
  configure(consumer: MiddlewareConsumer): void {
    const auth = this.auth;
    consumer
      .apply((req: Request, res: Response, next: NextFunction): void => {
        void runAuth(auth, req, res, next);
      })
      .forRoutes('mcp');
  }
}
