import { TelegramAllowedUserRepository, TelegramBotRepository, type TelegramBot } from '@mnela/db';
import { createKeystore, type Keystore, resolveDataDir } from '@mnela/llm-providers';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { loadEnv } from '../env.js';

export interface ResolvedConfig {
  enabled: boolean;
  token: string | null;
  botUsername: string | null;
  botId: bigint | null;
  transport: 'polling' | 'webhook';
  webhookUrl: string | null;
  bundleWindowMs: number;
  defaultProjectSlug: string | null;
}

/**
 * Reads `TelegramBot` + `TelegramAllowedUser` from Postgres on demand and
 * decrypts the bot token via the shared keystore. Cached in-process for
 * the BotService lifecycle so a `system.telegram_reload` event only
 * triggers a single read.
 *
 * No state is held across reloads — `resolve()` always hits the DB.
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);
  private keystore!: Keystore;

  constructor(
    private readonly bots: TelegramBotRepository,
    private readonly allowed: TelegramAllowedUserRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.keystore = await createKeystore({
      envSecret: process.env['MNELA_PROVIDER_SECRET'],
      dataDir: resolveDataDir(env.MNELA_DATA_DIR),
    });
    this.logger.log(
      `keystore source=${this.keystore.source}${this.keystore.keyPath ? ` path=${this.keystore.keyPath}` : ''}`,
    );
  }

  async resolve(): Promise<ResolvedConfig> {
    const row = await this.bots.read();
    return {
      enabled: row.enabled,
      token: this.decryptToken(row),
      botUsername: row.botUsername ?? null,
      botId: row.botId ?? null,
      transport: row.transport,
      webhookUrl: row.webhookUrl ?? null,
      bundleWindowMs: row.bundleWindowMs,
      defaultProjectSlug: row.defaultProjectSlug ?? null,
    };
  }

  /**
   * Whitelist check — single source of truth. Called by the bot middleware
   * on every incoming update. Reads from DB each time to honour live
   * whitelist edits; the DB hit is cheap (PK lookup on `tgUserId`).
   */
  async isAllowed(tgUserId: bigint): Promise<boolean> {
    const row = await this.allowed.has(tgUserId);
    return row !== null;
  }

  private decryptToken(row: TelegramBot): string | null {
    if (!row.tokenEnc) return null;
    try {
      return this.keystore.decrypt(Buffer.from(row.tokenEnc));
    } catch (err) {
      this.logger.error(
        `tokenEnc decrypt failed: ${err instanceof Error ? err.message : String(err)} — keystore master key mismatch?`,
      );
      return null;
    }
  }
}
