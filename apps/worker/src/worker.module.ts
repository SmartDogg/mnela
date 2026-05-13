import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@mnela/db';
import { LoggerModule } from 'nestjs-pino';

import { DropboxWatcher } from './dropbox/dropbox.watcher.js';
import { loadEnv } from './env.js';
import { IngestionConsumer } from './ingestion/ingestion.consumer.js';
import { StubConsumersService } from './ingestion/stub-consumers.service.js';
import { RedisService } from './redis.service.js';
import { ReloadModule } from './reload/reload.module.js';
import { RepositoriesModule } from './repositories.module.js';
import { TranscriptionModule } from './transcription/transcription.module.js';

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
    ReloadModule,
    TranscriptionModule,
  ],
  providers: [PrismaService, RedisService, IngestionConsumer, StubConsumersService, DropboxWatcher],
  exports: [PrismaService, RedisService],
})
export class WorkerModule {}
