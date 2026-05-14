import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { Public } from '../../auth/public.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ClaudeService } from './claude.service.js';
import { SetConfigDto } from './dto.js';
import { SystemService } from './system.service.js';
import { WhisperService } from './whisper.service.js';

@ApiTags('system')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly claude: ClaudeService,
    private readonly whisper: WhisperService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('stats')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Counts of documents/entities/edges/projects/decisions and DB size' })
  stats() {
    return this.system.stats();
  }

  @Get('config')
  @RequiredScope('admin')
  @ApiOperation({
    summary:
      'Merged config: every registered spec with its default + DB override (if any). Drives the typed admin/system UI.',
  })
  listConfig() {
    return this.system.listConfig();
  }

  @Patch('config')
  @RequiredScope('admin')
  @Audit({ action: 'system.config.set', targetType: 'SystemConfig' })
  @ApiOperation({
    summary: 'Upsert an override for a registered config key. Value is validated against the spec.',
  })
  setConfig(@Body() body: SetConfigDto) {
    return this.system.setConfig(body.key, body.value);
  }

  @Delete('config/:key')
  @RequiredScope('admin')
  @Audit({ action: 'system.config.reset', targetType: 'SystemConfig', targetIdParam: 'key' })
  @ApiOperation({
    summary: 'Drop the DB override for a key so it falls back to its registry default.',
  })
  resetConfig(@Param('key') key: string) {
    return this.system.resetConfig(key);
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

  @Get('whisper-status')
  @Public()
  @ApiOperation({
    summary: 'whisper.cpp transcription availability (Redis-backed, mirror of claude-status)',
  })
  whisperStatus() {
    return this.whisper.getStatus();
  }

  @Post('transcribe-pending')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'system.transcribe_pending', targetType: 'System' })
  @ApiOperation({
    summary:
      'Backfill: enqueue transcription jobs for every audio Document still at status=raw (capped at 50; pass ?limit=N up to 200).',
  })
  transcribePending(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{ enqueued: number; jobIds: string[] }> {
    return this.documents.retranscribePending(limit);
  }

  @Post('restart')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'system.restart', targetType: 'System' })
  @ApiOperation({
    summary:
      'Hot-reload subsystems via mnela:events system.service_reload. Returns the per-subscriber acks (worker.ingestion, orchestrator.enrichment, api.search, api.throttler, …) collected within a 2.5s window so the UI can render an honest result instead of a blind timer.',
  })
  restart() {
    return this.system.requestRestart('manual');
  }
}
