import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Audit } from '../../../audit/audit.decorator.js';
import { RequiredScope } from '../../../auth/scope.decorator.js';
import { backupsDir } from '../../../env.js';
import { BackupsService } from './backups.service.js';
import type { BackupRunStatus, BackupSummary } from './backups.service.js';
import { BACKUP_UPLOAD_RAW_CEILING_BYTES, backupUploadStorage } from './backups-upload.config.js';
import type { RestoreLastResult, RestoreValidationResult } from './restore.service.js';
import { RestoreService } from './restore.service.js';

@ApiTags('admin')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('admin/backups')
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly restore: RestoreService,
  ) {}

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

  // ---- Upload + restore ---------------------------------------------------

  @Post('upload')
  @RequiredScope('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: backupUploadStorage,
      limits: { fileSize: BACKUP_UPLOAD_RAW_CEILING_BYTES },
    }),
  )
  @Audit({ action: 'backups.upload', targetType: 'Backup', transactional: false })
  @ApiOperation({
    summary:
      'Upload a backup .tar.gz produced on another host. Streams to the mnela-backups volume; the file shows up in GET /admin/backups for restore selection.',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ filename: string; sizeBytes: number }> {
    if (!file) throw new BadRequestException('Missing file field "file"');
    if (!file.originalname.match(/\.tar\.gz$/)) {
      await unlink(file.path).catch(() => undefined);
      throw new BadRequestException('Expected a .tar.gz bundle.');
    }
    const safeBase = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = `mnela-uploaded-${Date.now()}-${safeBase}`;
    if (!/^mnela-[\w-]+\.tar\.gz$/.test(target)) {
      // Extremely defensive — the regex above should always pass for any
      // sanitised name with the right extension. Reject if not.
      await unlink(file.path).catch(() => undefined);
      throw new BadRequestException('Sanitised filename does not match the expected pattern.');
    }
    const finalPath = path.join(backupsDir(), target);
    await rename(file.path, finalPath);
    return { filename: target, sizeBytes: file.size };
  }

  @Post(':filename/validate')
  @RequiredScope('admin')
  @ApiOperation({
    summary:
      'Pre-flight validation: extracts manifest + provider.key from the bundle and verifies the key decrypts the first LlmProvider.apiKeyEnc row in the dump. Pure read; no destructive ops.',
  })
  validate(@Param('filename') filename: string): Promise<RestoreValidationResult> {
    return this.restore.validate(filename);
  }

  @Post(':filename/restore')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({
    action: 'backups.restore',
    targetType: 'Backup',
    targetIdParam: 'filename',
    transactional: false,
  })
  @ApiOperation({
    summary:
      'DESTRUCTIVE. Replace the current database + /data volume with the bundle contents. The api enters maintenance mode (all non-status endpoints return 503) while pg_restore + untar run in-process. UI polls GET /admin/backups/restore/status until done; sessions are wiped, so callers must re-login.',
  })
  startRestore(@Param('filename') filename: string): Promise<{ jobId: string }> {
    return this.restore.start(filename);
  }

  @Get('restore/status')
  @RequiredScope('admin')
  @ApiOperation({
    summary:
      'Last restore run in this api process (running / done / failed). Returns null if no restore has been initiated since boot. Bypasses the maintenance gate so the UI can poll it during the restore.',
  })
  restoreStatus(): { last: RestoreLastResult | null } {
    return { last: this.restore.getLastResult() };
  }
}
