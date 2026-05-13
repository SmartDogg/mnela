import path from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MNELA_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MNELA_DATA_DIR: z.string().default('./data'),
  // Whisper user-facing settings (enabled / model / language) live in
  // SystemConfig (transcription.* keys). Only the deploy-time wiring
  // (where the worker reaches the whisper container) stays in env.
  WHISPER_URL: z.string().url().default('http://whisper:8080'),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  // Per-job memory under chatgpt account-export parsing can spike to
  // ~1 GB (parses 700+ conversations across 18 shards into JS objects,
  // on top of streaming several hundred MB of nested ZIPs to disk). At
  // concurrency=4 four parallel runs blow past Node's 4 GB heap and the
  // worker OOMs silently. 2 strikes a balance between throughput on
  // small files and safety on multi-GB exports. Live tuning lives at
  // `worker.ingestion.concurrency` — this is just the boot fallback.
  WORKER_INGESTION_CONCURRENCY: z.coerce.number().int().positive().default(2),
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
