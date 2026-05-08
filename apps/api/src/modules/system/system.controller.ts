import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { Public } from '../../auth/public.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { ClaudeService } from './claude.service.js';
import { SetConfigDto } from './dto.js';
import { SystemService } from './system.service.js';

@ApiTags('system')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly claude: ClaudeService,
  ) {}

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
  @ApiOperation({ summary: 'Server-side Claude Code availability (Redis-backed, ADR-0029)' })
  claudeStatus() {
    return this.claude.getStatus();
  }

  @Post('claude-test')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'system.claude_test', targetType: 'System' })
  @ApiOperation({ summary: 'Probe Claude Code binary and refresh status' })
  claudeTest() {
    return this.claude.runTest();
  }
}
