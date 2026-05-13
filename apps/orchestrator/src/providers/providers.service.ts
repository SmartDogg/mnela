/**
 * Orchestrator-side mirror of apps/api/src/modules/providers/providers.service.ts.
 *
 * The orchestrator runs enrichment + vision + project-context jobs that pull
 * from the same LlmProvider table the api manages — but it needs its own
 * instance because the Claude CLI subprocess runtime (timeout, env, paths)
 * differs from the api's defaults (longer timeout, full DATABASE_URL chain).
 */

import { readRegistryValue } from '@mnela/core';
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
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { loadEnv, mcpConfigPath, vaultDir } from '../env.js';

export type OrchestratorFeatureKey = 'enrichment' | 'vision' | 'projectContext' | 'projectSuggest';

const FEATURE_CONFIG_KEYS: Record<OrchestratorFeatureKey, string> = {
  enrichment: 'providers.enrichment',
  vision: 'providers.vision',
  projectContext: 'providers.projectContext',
  // ADR-0051: project_suggest reuses the enrichment provider routing —
  // we don't surface a separate `providers.projectSuggest` key because the
  // naming call is a single Haiku-class request and the operator already
  // has fine-grained control via enrichment/default routing.
  projectSuggest: 'providers.enrichment',
};

@Injectable()
export class OrchestratorProvidersService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorProvidersService.name);
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
      mcpConfig: mcpConfigPath(env),
      addDirs: [vaultDir(env)],
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

  builtinCliProvider(): ClaudeCliProvider {
    return new ClaudeCliProvider(this.runtime);
  }

  async resolveForFeature(feature: OrchestratorFeatureKey): Promise<LLMProvider> {
    const perFeature = await readRegistryValue<string>(
      this.systemConfig,
      FEATURE_CONFIG_KEYS[feature],
    );
    if (perFeature && perFeature.length > 0) {
      return this.build(perFeature);
    }
    if (feature === 'projectContext') {
      const enrichment = await readRegistryValue<string>(this.systemConfig, 'providers.enrichment');
      if (enrichment && enrichment.length > 0) return this.build(enrichment);
    }
    const defaultId = await readRegistryValue<string>(this.systemConfig, 'providers.default');
    if (defaultId && defaultId.length > 0) return this.build(defaultId);
    return this.builtinCliProvider();
  }

  private async build(id: string): Promise<LLMProvider> {
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

  private decode(row: {
    id: string;
    name: string;
    kind: string;
    model: string;
    baseUrl: string | null;
    /**
     * Prisma 6 surfaces Bytes as `Uint8Array`, not `Buffer`. The keystore
     * accepts Buffer at call time; we widen here and wrap once below.
     */
    apiKeyEnc: Uint8Array | null;
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
        out.apiKey = this.keystore.decrypt(Buffer.from(row.apiKeyEnc));
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
