/**
 * ProvidersService — instantiates `LLMProvider` objects from the LlmProvider
 * table (or from the built-in claude-cli sentinel) and resolves the right
 * provider for a given feature key.
 *
 * The router is intentionally tiny: read SystemConfig keys
 *   providers.<feature> → providers.default → BUILTIN_CLAUDE_CLI_ID
 * and instantiate. Builds are cheap (just constructor calls) and we don't
 * cache across requests so an admin tweak takes effect immediately.
 */

import { LlmProviderRepository, SystemConfigRepository } from '@mnela/db';
import {
  AnthropicApiProvider,
  BUILTIN_CLAUDE_CLI_ID,
  ClaudeCliProvider,
  type ClaudeCliRuntime,
  createKeystore,
  type Keystore,
  type LLMProvider,
  OpenAiCompatibleProvider,
  type ProviderConfig,
  resolveDataDir,
} from '@mnela/llm-providers';
import { readRegistryValue } from '@mnela/core';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { claudeMcpConfigPath, claudeVaultDir, loadEnv } from '../../env.js';

export type FeatureKey = 'ask' | 'enrichment' | 'vision' | 'projectContext';

export const FEATURE_CONFIG_KEYS: Record<FeatureKey, string> = {
  ask: 'providers.ask',
  enrichment: 'providers.enrichment',
  vision: 'providers.vision',
  projectContext: 'providers.projectContext',
};

@Injectable()
export class ProvidersService implements OnModuleInit {
  private readonly logger = new Logger(ProvidersService.name);
  private keystore!: Keystore;
  private runtime!: ClaudeCliRuntime;

  constructor(
    private readonly providersRepo: LlmProviderRepository,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.keystore = await createKeystore({
      envSecret: process.env['MNELA_PROVIDER_SECRET'],
      dataDir: resolveDataDir(env.MNELA_DATA_DIR),
    });
    this.runtime = {
      bin: env.MNELA_CLAUDE_BIN,
      mcpConfig: claudeMcpConfigPath(env),
      addDirs: [claudeVaultDir(env)],
      timeoutMs: env.MNELA_CLAUDE_TIMEOUT_MS,
      envForward: {
        DATABASE_URL: env.DATABASE_URL,
        REDIS_URL: env.REDIS_URL,
        MNELA_DATA_DIR: env.MNELA_DATA_DIR,
        MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
      },
    };
    this.logger.log(
      `provider keystore: source=${this.keystore.source}${this.keystore.keyPath ? ` path=${this.keystore.keyPath}` : ''}`,
    );
  }

  /** Built-in always-on Claude CLI provider — never persisted. */
  builtinCliProvider(): ClaudeCliProvider {
    return new ClaudeCliProvider(this.runtime);
  }

  /** Listing for the admin UI. Includes a virtual `builtin:claude-cli` row. */
  async listAll(): Promise<{ row: ProviderConfig; builtin: boolean }[]> {
    const rows = await this.providersRepo.list();
    const out: { row: ProviderConfig; builtin: boolean }[] = [
      { row: this.builtinCliProvider().config, builtin: true },
    ];
    for (const r of rows) {
      out.push({ row: this.decode(r), builtin: false });
    }
    return out;
  }

  async findById(id: string): Promise<ProviderConfig | null> {
    if (id === BUILTIN_CLAUDE_CLI_ID) return this.builtinCliProvider().config;
    const row = await this.providersRepo.findById(id);
    return row ? this.decode(row) : null;
  }

  async getKeystore(): Promise<Keystore> {
    return this.keystore;
  }

  /**
   * Materialise a provider instance for `id`. Falls back to the built-in
   * Claude CLI if the row is missing or the dynamic import (Anthropic SDK)
   * fails — we never want a routing miss to break /ask.
   */
  async build(id: string): Promise<LLMProvider> {
    if (id === BUILTIN_CLAUDE_CLI_ID) return this.builtinCliProvider();
    const row = await this.providersRepo.findById(id);
    if (!row) {
      this.logger.warn(`provider ${id} not found — falling back to built-in claude-cli`);
      return this.builtinCliProvider();
    }
    const config = this.decode(row);
    try {
      switch (config.kind) {
        case 'claude_cli':
          return this.builtinCliProvider();
        case 'anthropic_api':
          return new AnthropicApiProvider(config);
        case 'openai_compat':
          return new OpenAiCompatibleProvider(config);
      }
    } catch (err) {
      this.logger.error(
        `failed to instantiate provider ${id}: ${err instanceof Error ? err.message : String(err)}; falling back to built-in claude-cli`,
      );
      return this.builtinCliProvider();
    }
  }

  /**
   * Resolve a provider for a feature. SystemConfig is consulted in order:
   *   providers.<feature> → providers.default → BUILTIN.
   * Empty / unknown / deleted ids fall back gracefully.
   */
  async resolveForFeature(feature: FeatureKey): Promise<LLMProvider> {
    const perFeature = await readRegistryValue<string>(
      this.systemConfig,
      FEATURE_CONFIG_KEYS[feature],
    );
    if (perFeature && perFeature.length > 0) {
      return this.build(perFeature);
    }
    const defaultId = await readRegistryValue<string>(this.systemConfig, 'providers.default');
    if (defaultId && defaultId.length > 0) {
      return this.build(defaultId);
    }
    return this.builtinCliProvider();
  }

  /** Map a DB row → decrypted ProviderConfig consumed by the provider classes. */
  private decode(row: {
    id: string;
    name: string;
    kind: string;
    model: string;
    baseUrl: string | null;
    apiKeyEnc: Buffer | null;
    extra: unknown;
  }): ProviderConfig {
    const out: ProviderConfig = {
      id: row.id,
      name: row.name,
      kind: row.kind as ProviderConfig['kind'],
      model: row.model,
    };
    if (row.baseUrl) out.baseUrl = row.baseUrl;
    if (row.apiKeyEnc) {
      try {
        out.apiKey = this.keystore.decrypt(row.apiKeyEnc);
      } catch (err) {
        this.logger.error(
          `failed to decrypt apiKey for provider ${row.id}: ${err instanceof Error ? err.message : String(err)} — provider will fail at call time`,
        );
      }
    }
    if (row.extra && typeof row.extra === 'object')
      out.extra = row.extra as Record<string, unknown>;
    return out;
  }
}
