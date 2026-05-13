/**
 * /admin/telegram — config CRUD + whitelist + getMe probe.
 *
 * Plaintext tokens never travel back to the client (responses only carry
 * `hasToken` + `tokenLast4`). Audit-logged like every admin mutation —
 * the `token` field is in the redact list so the encrypted blob and the
 * plaintext (passed in via UpdateTelegramConfigDto) never land in
 * AuditLog.before/after.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { UpdateTelegramConfigDto, UpsertAllowedUserDto } from './dto.js';
import {
  type TelegramConfigDto,
  type TestConnectionResult,
  TelegramService,
} from './telegram.service.js';

interface AllowedUserResponse {
  tgUserId: string;
  label: string | null;
  createdAt: string;
}

@ApiTags('admin/telegram')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('admin/telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('config')
  @RequiredScope('admin')
  @ApiOperation({ summary: 'Read Telegram bot config (token redacted to last4).' })
  config(): Promise<TelegramConfigDto> {
    return this.telegram.readConfig();
  }

  @Put('config')
  @RequiredScope('admin')
  @Audit({ action: 'telegram.config.update', targetType: 'TelegramBot', redact: ['token'] })
  @ApiOperation({
    summary: 'Update config. Pass token:null to clear; omit to keep. Triggers bot hot-reload.',
  })
  updateConfig(@Body() body: UpdateTelegramConfigDto): Promise<TelegramConfigDto> {
    return this.telegram.updateConfig(body);
  }

  @Post('test')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'telegram.test', targetType: 'TelegramBot' })
  @ApiOperation({ summary: 'Probe the bot identity via Telegram getMe. Caches botUsername+botId.' })
  test(): Promise<TestConnectionResult> {
    return this.telegram.testConnection();
  }

  @Get('whitelist')
  @RequiredScope('admin')
  @ApiOperation({ summary: 'List Telegram user IDs allowed to message the bot.' })
  async listWhitelist(): Promise<AllowedUserResponse[]> {
    const rows = await this.telegram.listAllowedUsers();
    return rows.map((r) => ({
      tgUserId: String(r.tgUserId),
      label: r.label ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Post('whitelist')
  @RequiredScope('admin')
  @Audit({ action: 'telegram.whitelist.upsert', targetType: 'TelegramAllowedUser' })
  @ApiOperation({ summary: 'Add or relabel a Telegram user.' })
  async upsertWhitelist(@Body() body: UpsertAllowedUserDto): Promise<AllowedUserResponse> {
    const row = await this.telegram.upsertAllowedUser(BigInt(body.tgUserId), body.label ?? null);
    return {
      tgUserId: String(row.tgUserId),
      label: row.label ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Delete('whitelist/:tgUserId')
  @RequiredScope('admin')
  @Audit({
    action: 'telegram.whitelist.delete',
    targetType: 'TelegramAllowedUser',
    targetIdParam: 'tgUserId',
  })
  @ApiOperation({ summary: 'Revoke a Telegram user.' })
  async deleteWhitelist(@Param('tgUserId') tgUserId: string): Promise<{ deleted: boolean }> {
    const id = parseBigInt(tgUserId);
    const deleted = await this.telegram.deleteAllowedUser(id);
    if (!deleted) throw new NotFoundException(`User ${tgUserId} not in whitelist`);
    return { deleted };
  }
}

function parseBigInt(raw: string): bigint {
  if (!/^-?\d+$/.test(raw)) {
    throw new NotFoundException(`Invalid Telegram user_id: ${raw}`);
  }
  return BigInt(raw);
}
