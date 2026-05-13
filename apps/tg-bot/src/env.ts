import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6380'),

  /**
   * Base URL for the apps/api service. Includes the global `/api/v1`
   * prefix that NestJS sets — every endpoint we call (/search/ask,
   * /documents/upload, /documents) lives under it. Hard-code IPv4
   * (`127.0.0.1`) because on Windows + Node 22 `localhost` may resolve
   * to `::1` first while the api binds 0.0.0.0 (IPv4-only) — same
   * pitfall apps/web hits, same fix.
   */
  MNELA_API_BASE_URL: z.string().url().default('http://127.0.0.1:3000/api/v1'),

  /**
   * Bearer token the bot uses for its OWN calls back into apps/api. This
   * is NOT the Telegram bot token — that one is encrypted in the DB. The
   * internal token must have scope `mcp` (covers /search/ask + /documents/
   * upload). Issue via /admin/system → API tokens.
   */
  MNELA_INTERNAL_TOKEN: z.string().min(20),

  /**
   * Directory shared with apps/api for the AES-256-GCM keystore that
   * decrypts TelegramBot.tokenEnc. Defaults to the repo-relative ./data;
   * `@mnela/llm-providers/resolveDataDir` resolves it against the repo
   * root so every process lands on the same keystore file.
   */
  MNELA_DATA_DIR: z.string().default('./data'),

  MNELA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
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
