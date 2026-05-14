import { Global, Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { ClaudeService } from './claude.service.js';
import { HealthController } from './health.controller.js';
import { ReloadService } from './reload.service.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';
import { ThrottlerReloadBoot } from './throttler-reload.boot.js';
import { WhisperService } from './whisper.service.js';

@Global()
@Module({
  imports: [DocumentsModule],
  controllers: [HealthController, SystemController],
  providers: [SystemService, ClaudeService, WhisperService, ReloadService, ThrottlerReloadBoot],
  exports: [SystemService, ReloadService],
})
export class SystemModule {}
