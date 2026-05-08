import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { loadEnv } from './env.js';
import { IngestionConsumer } from './ingestion/ingestion.consumer.js';
import { StubConsumersService } from './ingestion/stub-consumers.service.js';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { RepositoriesModule } from './repositories.module.js';

const env = loadEnv();

@Global()
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
    RepositoriesModule,
  ],
  providers: [PrismaService, RedisService, IngestionConsumer, StubConsumersService],
  exports: [PrismaService, RedisService],
})
export class WorkerModule {}
