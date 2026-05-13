import { Module } from '@nestjs/common';
import { PrismaModule, RepositoriesModule } from '@mnela/db';
import { LoggerModule } from 'nestjs-pino';

import { ApiClientModule } from './api-client/api-client.module.js';
import { BotModule } from './bot/bot.module.js';
import { ConfigModule } from './config/config.module.js';
import { loadEnv } from './env.js';
import { RedisModule } from './redis/redis.module.js';

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
      },
    }),
    PrismaModule,
    RepositoriesModule,
    RedisModule,
    ConfigModule,
    ApiClientModule,
    BotModule,
  ],
})
export class TgBotModule {}
