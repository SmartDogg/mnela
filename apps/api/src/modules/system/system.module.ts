import { Global, Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { BackupsController } from './backups/backups.controller.js';
import { BackupsService } from './backups/backups.service.js';
import { RestoreService } from './backups/restore.service.js';
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
  controllers: [HealthController, SystemController, BackupsController],
  providers: [
    SystemService,
    ClaudeService,
    WhisperService,
    ReloadService,
    RateLimitReloadBoot,
    BackupsService,
    RestoreService,
  ],
  exports: [SystemService, ReloadService],
})
export class SystemModule {}
