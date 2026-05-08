import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { PrismaModule, RepositoriesModule } from '@mnela/db';
import { LoggerModule } from 'nestjs-pino';

import { AuthMiddleware } from './auth/auth.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './env.js';
import { HealthModule } from './health/health.module.js';

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
    AuthModule,
    HealthModule,
  ],
})
export class McpModule implements NestModule {
  // Bearer auth applies only to the JSON-RPC surface; /health stays open so
  // container probes don't need credentials. ADR-0033: per-call DB verify.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes('mcp');
  }
}
