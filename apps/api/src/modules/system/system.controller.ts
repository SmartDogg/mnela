import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { Public } from '../../auth/public.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { SetConfigDto } from './dto.js';
import { SystemService } from './system.service.js';

@ApiTags('system')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('stats')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Counts of documents/entities/edges/projects/decisions and DB size' })
  stats() {
    return this.system.stats();
  }

  @Get('config')
  @RequiredScope('admin')
  @ApiOperation({ summary: 'List all system config entries' })
  listConfig() {
    return this.system.listConfig();
  }

  @Patch('config')
  @RequiredScope('admin')
  @Audit({ action: 'system.config.set', targetType: 'SystemConfig' })
  @ApiOperation({ summary: 'Upsert a system config entry by key' })
  setConfig(@Body() body: SetConfigDto) {
    return this.system.setConfig(body.key, body.value);
  }

  @Get('claude-status')
  @Public()
  @ApiOperation({ summary: 'Server-side Claude Code status (Phase 5; currently unavailable)' })
  claudeStatus() {
    return {
      available: false,
      reason: 'phase-5-pending',
      message: 'Claude Code orchestrator is not configured in Phase 1',
    };
  }

  @Post('claude-test')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe Claude Code (Phase 5; currently unavailable)' })
  claudeTest(): never {
    throw new ServiceUnavailableException({
      title: 'AI Smart Mode disabled',
      message: 'Claude Code orchestrator is not configured (Phase 5)',
    });
  }
}
