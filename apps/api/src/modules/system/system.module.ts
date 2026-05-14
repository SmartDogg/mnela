import { Global, Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { ClaudeService } from './claude.service.js';
import { HealthController } from './health.controller.js';
import { RateLimitReloadBoot } from './rate-limit-reload.boot.js';
import { ReloadService } from './reload.service.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';
import { WhisperService } from './whisper.service.js';

@Global()
@Module({
  imports: [DocumentsModule],
  controllers: [HealthController, SystemController],
  providers: [SystemService, ClaudeService, WhisperService, ReloadService, RateLimitReloadBoot],
  exports: [SystemService, ReloadService],
})
export class SystemModule {}
