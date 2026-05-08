import { Module } from '@nestjs/common';

import { ClaudeService } from './claude.service.js';
import { HealthController } from './health.controller.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

@Module({
  controllers: [HealthController, SystemController],
  providers: [SystemService, ClaudeService],
})
export class SystemModule {}
