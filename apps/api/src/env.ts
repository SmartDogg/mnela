import path from 'node:path';

import { resolveDataDir } from '@mnela/llm-providers';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  COOKIE_SECRET: z.string().min(16).default('mnela-dev-cookie-secret-change-me'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  ADMIN_INITIAL_USERNAME: z.string().min(1).optional(),
  ADMIN_INITIAL_PASSWORD: z.string().min(12).optional(),

  MNELA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MNELA_DATA_DIR: z.string().default('./data'),

  /** Boot-time fallback for the global rate limit when SystemConfig is
   * not yet reachable. Live tuning lives at `api.rateLimit.global`. */
  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().positive().default(100),

  // Ask Brain (Phase 8) — same Claude binary + MCP config as the orchestrator.
  MNELA_CLAUDE_BIN: z.string().default('claude'),
  MNELA_CLAUDE_VAULT_DIR: z.string().optional(),
  MNELA_CLAUDE_MCP_CONFIG: z.string().optional(),
  MNELA_CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  ASK_DUMB_MODE_FTS_LIMIT: z.coerce.number().int().positive().max(20).default(5),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Resolves `MNELA_DATA_DIR` relative to the **repo root** (where
 * `pnpm-workspace.yaml` lives), not the per-process cwd. Without this,
 * `pnpm --filter @mnela/api dev` lands in `apps/api/` and `./data`
 * becomes `apps/api/data/` — a nonexistent path that breaks claude
 * subprocess MCP wiring. The walker mirrors `@mnela/llm-providers`
 * `resolveDataDir` so api/orchestrator/worker all share one data dir
 * out of the box (override with an absolute `MNELA_DATA_DIR` for prod).
 */
export function resolvedDataDir(env: AppEnv = loadEnv()): string {
  return path.isAbsolute(env.MNELA_DATA_DIR)
    ? env.MNELA_DATA_DIR
    : resolveDataDir(env.MNELA_DATA_DIR);
}

export function claudeVaultDir(env: AppEnv = loadEnv()): string {
  return env.MNELA_CLAUDE_VAULT_DIR ?? path.resolve(resolvedDataDir(env), 'vault');
}

export function claudeMcpConfigPath(env: AppEnv = loadEnv()): string {
  return (
    env.MNELA_CLAUDE_MCP_CONFIG ??
    path.resolve(resolvedDataDir(env), 'claude/claude-mcp-config.json')
  );
}
