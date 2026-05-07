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

  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(10),

  SEARCH_FTS_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  SEARCH_TRIGRAM_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
  SEARCH_TRIGRAM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
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
