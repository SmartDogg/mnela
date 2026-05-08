import path from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MNELA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MNELA_DATA_DIR: z.string().default('./data'),
  MNELA_TRANSCRIPTION: z.enum(['enabled', 'disabled']).default('disabled'),
  WORKER_INGESTION_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_DROPBOX_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Worker invalid env:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export function attachmentsDir(env: WorkerEnv = loadEnv()): string {
  return path.resolve(env.MNELA_DATA_DIR, 'attachments');
}

export function dropboxDir(env: WorkerEnv = loadEnv()): string {
  return path.resolve(env.MNELA_DATA_DIR, 'dropbox');
}

export function uploadsDir(env: WorkerEnv = loadEnv()): string {
  return path.resolve(env.MNELA_DATA_DIR, 'uploads');
}
