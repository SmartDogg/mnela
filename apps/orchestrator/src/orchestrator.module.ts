import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@mnela/db';
import { LoggerModule } from 'nestjs-pino';

import { ClaudeStatusBoot } from './claude-status/claude-status.boot.js';
import { ClaudeStatusService } from './claude-status/claude-status.service.js';
import { EnrichmentConsumer } from './enrichment/enrichment.consumer.js';
import { EnrichmentPipeline } from './enrichment/pipeline.js';
import { EnrichmentQueueStateService } from './enrichment/queue-state.service.js';
import { loadEnv } from './env.js';
import { McpConfigBoot } from './mcp/mcp-config.boot.js';
import { OrchestratorProvidersService } from './providers/providers.service.js';
import { ProjectsAutofillService } from './projects/projects-autofill.service.js';
import { ProjectsConsumer } from './projects/projects.consumer.js';
import { ProjectsQueueService } from './projects/projects-queue.service.js';
import { ProjectsSuggesterService } from './projects/projects-suggester.service.js';
import { SuggestionDetector } from './projects/detector.js';
import { SuggestionNamer } from './projects/naming.js';
import { RateLimitService } from './rate-limit/rate-limit.service.js';
import { RedisService } from './redis.service.js';
import { RepositoriesModule } from './repositories.module.js';
import { SearchBridge } from './search-bridge.js';

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
  providers: [
    PrismaService,
    RedisService,
    SearchBridge,
    ClaudeStatusService,
    McpConfigBoot,
    ClaudeStatusBoot,
    RateLimitService,
    OrchestratorProvidersService,
    EnrichmentPipeline,
    EnrichmentConsumer,
    EnrichmentQueueStateService,
    SuggestionDetector,
    SuggestionNamer,
    ProjectsSuggesterService,
    ProjectsAutofillService,
    ProjectsQueueService,
    ProjectsConsumer,
  ],
  exports: [
    PrismaService,
    RedisService,
    ClaudeStatusService,
    RateLimitService,
    SearchBridge,
    ProjectsQueueService,
  ],
})
export class OrchestratorModule {}
