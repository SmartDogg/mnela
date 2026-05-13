/**
 * TelegramService — singleton-config CRUD + bot identity probe.
 *
 * Owns the encryption/decryption of `TelegramBot.tokenEnc` against the
 * shared keystore (same one that holds `LlmProvider.apiKeyEnc`). API
 * responses never include the plaintext token nor the encrypted blob —
 * only `hasToken: boolean` + `tokenLast4: string | null`. Every mutation
 * publishes a `system.telegram_reload` event on the Redis pubsub channel
 * so apps/tg-bot can restart its grammY connection without a deploy.
 *
 * `testConnection()` calls Telegram's getMe over plain fetch — we don't
 * pull in grammY here because the api process doesn't run the bot; the
 * probe is just enough to validate the token and cache `botUsername` +
 * `botId` for the admin UI.
 */

import {
  TelegramAllowedUserRepository,
  TelegramBotRepository,
  type TelegramAllowedUser,
  type TelegramBot,
} from '@mnela/db';
import { publishEvent } from '@mnela/queue';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createKeystore, type Keystore, resolveDataDir } from '@mnela/llm-providers';

import { loadEnv } from '../../env.js';
import { RedisService } from '../../redis.service.js';

export interface TelegramConfigDto {
  enabled: boolean;
  hasToken: boolean;
  tokenLast4: string | null;
  botUsername: string | null;
  botId: string | null;
  transport: 'polling' | 'webhook';
  webhookUrl: string | null;
  bundleWindowMs: number;
  defaultProjectSlug: string | null;
  updatedAt: string;
}

export interface TestConnectionResult {
  ok: boolean;
  botId?: string;
  botUsername?: string;
  botFirstName?: string;
  latencyMs: number;
  error?: string;
}

interface GetMeResponse {
  ok: boolean;
  result?: { id: number; is_bot: boolean; first_name: string; username?: string };
  description?: string;
  error_code?: number;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private keystore!: Keystore;

  constructor(
    private readonly bots: TelegramBotRepository,
    private readonly allowed: TelegramAllowedUserRepository,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.keystore = await createKeystore({
      envSecret: process.env['MNELA_PROVIDER_SECRET'],
      dataDir: resolveDataDir(env.MNELA_DATA_DIR),
    });
  }

  async readConfig(): Promise<TelegramConfigDto> {
    const row = await this.bots.read();
    return this.shape(row);
  }

  /** Returns the plaintext token if one is set — used by apps/tg-bot only,
   * never by API responses. */
  async readPlaintextToken(): Promise<string | null> {
    const row = await this.bots.read();
    if (!row.tokenEnc) return null;
    try {
      return this.keystore.decrypt(Buffer.from(row.tokenEnc));
    } catch (err) {
      this.logger.error(
        `telegram token decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async updateConfig(input: {
    enabled?: boolean;
    token?: string | null;
    transport?: 'polling' | 'webhook';
    webhookUrl?: string | null;
    bundleWindowMs?: number;
    defaultProjectSlug?: string | null;
  }): Promise<TelegramConfigDto> {
    const patch: Parameters<typeof this.bots.update>[0] = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.token !== undefined) {
      if (input.token === null) {
        patch.tokenEnc = null;
        patch.tokenLast4 = null;
        patch.botUsername = null;
        patch.botId = null;
      } else {
        patch.tokenEnc = this.keystore.encrypt(input.token);
        patch.tokenLast4 = input.token.slice(-4);
      }
    }
    if (input.transport !== undefined) patch.transport = input.transport;
    if (input.webhookUrl !== undefined) patch.webhookUrl = input.webhookUrl;
    if (input.bundleWindowMs !== undefined) patch.bundleWindowMs = input.bundleWindowMs;
    if (input.defaultProjectSlug !== undefined) patch.defaultProjectSlug = input.defaultProjectSlug;

    const updated = await this.bots.update(patch);
    await this.publishReload('config-changed');
    return this.shape(updated);
  }

  async testConnection(): Promise<TestConnectionResult> {
    const token = await this.readPlaintextToken();
    if (!token) {
      return { ok: false, latencyMs: 0, error: 'No token configured' };
    }
    const start = Date.now();
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - start;
      const body = (await res.json()) as GetMeResponse;
      if (!body.ok || !body.result) {
        return {
          ok: false,
          latencyMs,
          error: body.description ?? `HTTP ${res.status}`,
        };
      }
      // Cache the identity for the admin UI; don't bother on failures.
      await this.bots.update({
        botId: BigInt(body.result.id),
        botUsername: body.result.username ?? null,
      });
      const result: TestConnectionResult = {
        ok: true,
        latencyMs,
        botId: String(body.result.id),
        botFirstName: body.result.first_name,
      };
      if (body.result.username !== undefined) result.botUsername = body.result.username;
      return result;
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ----- Whitelist -----

  listAllowedUsers(): Promise<TelegramAllowedUser[]> {
    return this.allowed.list();
  }

  async upsertAllowedUser(tgUserId: bigint, label: string | null): Promise<TelegramAllowedUser> {
    const row = await this.allowed.upsert({ tgUserId, label });
    await this.publishReload('whitelist-changed');
    return row;
  }

  async deleteAllowedUser(tgUserId: bigint): Promise<boolean> {
    const ok = await this.allowed.delete(tgUserId);
    if (ok) await this.publishReload('whitelist-changed');
    return ok;
  }

  // ----- internals -----

  private shape(row: TelegramBot): TelegramConfigDto {
    return {
      enabled: row.enabled,
      hasToken: row.tokenEnc !== null && row.tokenEnc !== undefined,
      tokenLast4: row.tokenLast4 ?? null,
      botUsername: row.botUsername ?? null,
      botId: row.botId !== null && row.botId !== undefined ? String(row.botId) : null,
      transport: row.transport,
      webhookUrl: row.webhookUrl ?? null,
      bundleWindowMs: row.bundleWindowMs,
      defaultProjectSlug: row.defaultProjectSlug ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async publishReload(
    reason: 'config-changed' | 'whitelist-changed' | 'manual',
  ): Promise<void> {
    try {
      await publishEvent(this.redis.client, {
        type: 'system.telegram_reload',
        payload: { reason },
      });
    } catch (err) {
      // Best-effort; bot will pick up changes on its next poll regardless.
      this.logger.warn(
        `failed to publish telegram_reload: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
