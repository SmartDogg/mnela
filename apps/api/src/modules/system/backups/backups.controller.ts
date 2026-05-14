import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Audit } from '../../../audit/audit.decorator.js';
import { RequiredScope } from '../../../auth/scope.decorator.js';
import { BackupsService } from './backups.service.js';
import type { BackupRunStatus, BackupSummary } from './backups.service.js';

@ApiTags('admin')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('admin/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @RequiredScope('admin')
  @ApiOperation({
    summary: 'List backup bundles + the current run status (one concurrent run at a time).',
  })
  async list(): Promise<{ backups: BackupSummary[]; status: BackupRunStatus }> {
    const [backups, status] = await Promise.all([
      this.backups.listBackups(),
      this.backups.runningStatus(),
    ]);
    return { backups, status };
  }

  @Post('run')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'backups.run', targetType: 'Backup', transactional: false })
  @ApiOperation({
    summary:
      'Kick off a new backup. Returns 202 + jobId immediately; live progress arrives via the /live Socket.io namespace (backup.started / backup.progress / backup.done / backup.failed). Returns 409 if another backup is already running.',
  })
  run(): Promise<{ jobId: string }> {
    return this.backups.start();
  }

  @Get(':filename/download')
  @RequiredScope('admin')
  @ApiOperation({ summary: 'Stream a backup bundle as application/gzip with a download filename.' })
  async download(@Param('filename') filename: string, @Res() res: Response): Promise<void> {
    const { stream, sizeBytes } = await this.backups.openBackup(filename);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    stream.pipe(res);
  }

  @Delete(':filename')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'backups.delete', targetType: 'Backup', targetIdParam: 'filename' })
  @ApiOperation({ summary: 'Delete a stored backup bundle.' })
  async delete(@Param('filename') filename: string): Promise<void> {
    await this.backups.deleteBackup(filename);
  }
}
