import path from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MNELA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MNELA_DATA_DIR: z.string().default('./data'),

  MNELA_CLAUDE_BIN: z.string().default('claude'),
  MNELA_CLAUDE_VAULT_DIR: z.string().optional(),
  MNELA_CLAUDE_MCP_CONFIG: z.string().optional(),
  MNELA_CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  MNELA_ENRICHMENT_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MNELA_ENRICHMENT_RATE_PER_HOUR: z.coerce.number().int().positive().default(200),

  MNELA_CLAUDE_AVAILABLE_CHECK: z.enum(['boot', 'always-true', 'always-false']).default('boot'),
});

export type OrchestratorEnv = z.infer<typeof EnvSchema>;

let cached: OrchestratorEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): OrchestratorEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Orchestrator invalid env:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export function vaultDir(env: OrchestratorEnv = loadEnv()): string {
  return env.MNELA_CLAUDE_VAULT_DIR ?? path.resolve(env.MNELA_DATA_DIR, 'vault');
}

export function mcpConfigPath(env: OrchestratorEnv = loadEnv()): string {
  return (
    env.MNELA_CLAUDE_MCP_CONFIG ?? path.resolve(env.MNELA_DATA_DIR, 'claude/claude-mcp-config.json')
  );
}
