import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { ClaudeService } from './claude.service.js';
import { HealthController } from './health.controller.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';
import { WhisperService } from './whisper.service.js';

@Module({
  imports: [DocumentsModule],
  controllers: [HealthController, SystemController],
  providers: [SystemService, ClaudeService, WhisperService],
  exports: [SystemService],
})
export class SystemModule {}
