/**
 * /admin/providers — CRUD + helper actions for the LlmProvider table.
 *
 * The built-in `builtin:claude-cli` row is virtual: it shows up in GET but
 * can't be created/edited/deleted (a 400 fires if you try). Plaintext API
 * keys never travel back to the client — responses only surface `hasKey`
 * + `apiKeyLast4` for chip rendering.
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
  Patch,
  Post,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LlmProviderRepository, SystemConfigRepository } from '@mnela/db';
import { BUILTIN_CLAUDE_CLI_ID } from '@mnela/llm-providers';
import type { Prisma } from '@prisma/client';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import {
  ApplyDefaultEverywhereDto,
  CreateProviderDto,
  SetDefaultProviderDto,
  UpdateProviderDto,
} from './dto.js';
import { FEATURE_CONFIG_KEYS, ProvidersService } from './providers.service.js';

interface ProviderResponse {
  id: string;
  name: string;
  kind: 'claude_cli' | 'anthropic_api' | 'openai_compat';
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  apiKeyLast4: string | null;
  extra: Record<string, unknown> | null;
  builtin: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

@ApiTags('admin/providers')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('admin/providers')
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly providersRepo: LlmProviderRepository,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  @Get()
  @RequiredScope('admin')
  @ApiOperation({ summary: 'List all providers (including the virtual built-in claude-cli row)' })
  async list(): Promise<{ providers: ProviderResponse[]; defaults: Record<string, string> }> {
    const [providers, defaultId, ask, enrichment, vision, projectContext] = await Promise.all([
      this.providers.listAll(),
      this.readConfig('providers.default'),
      this.readConfig('providers.ask'),
      this.readConfig('providers.enrichment'),
      this.readConfig('providers.vision'),
      this.readConfig('providers.projectContext'),
    ]);
    const rows = await this.providersRepo.list();
    const rowsById = new Map(rows.map((r) => [r.id, r]));

    return {
      providers: providers.map(({ row, builtin }) => {
        const dbRow = builtin ? null : rowsById.get(row.id);
        return {
          id: row.id,
          name: row.name,
          kind: row.kind,
          model: row.model,
          baseUrl: row.baseUrl ?? null,
          hasKey: Boolean(dbRow?.apiKeyEnc),
          apiKeyLast4: dbRow?.apiKeyLast4 ?? null,
          extra: (row.extra as Record<string, unknown> | undefined) ?? null,
          builtin,
          createdAt: dbRow ? dbRow.createdAt.toISOString() : null,
          updatedAt: dbRow ? dbRow.updatedAt.toISOString() : null,
        };
      }),
      defaults: {
        default: defaultId ?? BUILTIN_CLAUDE_CLI_ID,
        ask: ask ?? '',
        enrichment: enrichment ?? '',
        vision: vision ?? '',
        projectContext: projectContext ?? '',
      },
    };
  }

  @Post()
  @RequiredScope('admin')
  @Audit({ action: 'providers.create', targetType: 'LlmProvider', redact: ['apiKey'] })
  @ApiOperation({ summary: 'Add an AI provider. apiKey is encrypted at rest.' })
  async create(@Body() body: CreateProviderDto): Promise<ProviderResponse> {
    if (body.kind === 'claude_cli') {
      throw new BadRequestException(
        'The built-in Claude Code (CLI) provider is virtual and cannot be persisted; nothing to create.',
      );
    }
    const keystore = await this.providers.getKeystore();
    const apiKeyEnc = body.apiKey ? keystore.encrypt(body.apiKey) : null;
    const apiKeyLast4 = body.apiKey ? body.apiKey.slice(-4) : null;
    const created = await this.providersRepo.create({
      name: body.name,
      kind: body.kind,
      model: body.model,
      ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
      ...(apiKeyEnc ? { apiKeyEnc } : {}),
      ...(apiKeyLast4 ? { apiKeyLast4 } : {}),
      ...(body.extra !== undefined ? { extra: body.extra as Prisma.InputJsonValue } : {}),
    });
    return this.shape(created);
  }

  @Patch(':id')
  @RequiredScope('admin')
  @Audit({
    action: 'providers.update',
    targetType: 'LlmProvider',
    targetIdParam: 'id',
    redact: ['apiKey'],
  })
  @ApiOperation({ summary: 'Update provider fields. Pass apiKey:null to clear, omit to keep.' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProviderDto,
  ): Promise<ProviderResponse> {
    if (id === BUILTIN_CLAUDE_CLI_ID) {
      throw new BadRequestException('The built-in claude-cli provider is read-only.');
    }
    const row = await this.providersRepo.findById(id);
    if (!row) throw new NotFoundException(`Provider ${id} not found`);
    const keystore = await this.providers.getKeystore();
    const patch: Parameters<typeof this.providersRepo.update>[1] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.model !== undefined) patch.model = body.model;
    if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
    if (body.apiKey !== undefined) {
      if (body.apiKey === null) {
        patch.apiKeyEnc = null;
        patch.apiKeyLast4 = null;
      } else {
        patch.apiKeyEnc = keystore.encrypt(body.apiKey);
        patch.apiKeyLast4 = body.apiKey.slice(-4);
      }
    }
    if (body.extra !== undefined) {
      patch.extra = body.extra === null ? null : (body.extra as Prisma.InputJsonValue);
    }
    const updated = await this.providersRepo.update(id, patch);
    return this.shape(updated);
  }

  @Delete(':id')
  @RequiredScope('admin')
  @Audit({ action: 'providers.delete', targetType: 'LlmProvider', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Remove a provider. Routing falls back to providers.default.' })
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    if (id === BUILTIN_CLAUDE_CLI_ID) {
      throw new BadRequestException('The built-in claude-cli provider is read-only.');
    }
    // Clear any SystemConfig key that still points at this provider, so the
    // UI doesn't ship a "Default = <deleted id>" zombie.
    for (const key of [
      'providers.default',
      'providers.ask',
      'providers.enrichment',
      'providers.vision',
      'providers.projectContext',
    ]) {
      const current = await this.readConfig(key);
      if (current === id) {
        if (key === 'providers.default') {
          await this.systemConfig.set(key, BUILTIN_CLAUDE_CLI_ID);
        } else {
          await this.systemConfig.delete(key);
        }
      }
    }
    const deleted = await this.providersRepo.delete(id);
    return { deleted };
  }

  @Post(':id/test')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'providers.test', targetType: 'LlmProvider', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Send a 16-token "say ok" probe to the provider.' })
  async test(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string }> {
    const provider = await this.providers.build(id);
    return provider.test();
  }

  @Post('defaults')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'providers.default.set', targetType: 'SystemConfig' })
  @ApiOperation({ summary: 'Set the default provider for a feature key (or globally).' })
  async setDefault(@Body() body: SetDefaultProviderDto): Promise<{ ok: true }> {
    const key =
      body.feature === 'default' ? 'providers.default' : FEATURE_CONFIG_KEYS[body.feature];
    if (body.providerId === '') {
      await this.systemConfig.delete(key);
    } else {
      await this.systemConfig.set(key, body.providerId);
    }
    return { ok: true };
  }

  @Post('defaults/apply-all')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'providers.default.apply_all', targetType: 'SystemConfig' })
  @ApiOperation({ summary: 'Sets every feature override to the chosen provider.' })
  async applyAll(@Body() body: ApplyDefaultEverywhereDto): Promise<{ ok: true }> {
    await Promise.all([
      this.systemConfig.set('providers.default', body.providerId),
      this.systemConfig.set('providers.ask', body.providerId),
      this.systemConfig.set('providers.enrichment', body.providerId),
      this.systemConfig.set('providers.vision', body.providerId),
      this.systemConfig.set('providers.projectContext', body.providerId),
    ]);
    return { ok: true };
  }

  private async readConfig(key: string): Promise<string | null> {
    const row = await this.systemConfig.get(key);
    if (!row) return null;
    const v = row.value;
    return typeof v === 'string' ? v : null;
  }

  private shape(row: Awaited<ReturnType<LlmProviderRepository['create']>>): ProviderResponse {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      model: row.model,
      baseUrl: row.baseUrl ?? null,
      hasKey: row.apiKeyEnc !== null && row.apiKeyEnc !== undefined,
      apiKeyLast4: row.apiKeyLast4 ?? null,
      extra: (row.extra as Record<string, unknown> | null) ?? null,
      builtin: false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
