import { Redis, type RedisOptions } from 'ioredis';

export const QUEUE_NAMES = [
  'ingestion',
  'enrichment',
  'indexing',
  'maintenance',
  'transcription',
  // ADR-0051: auto-suggested projects detector + manual project autofill.
  // Kept separate from `enrichment` so the slot-mutex + rate-limit logic
  // around Claude doesn't gate every cluster scan, and so a stuck Ask Brain
  // doesn't starve out the post-import detector.
  'projects',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

let sharedConnection: Redis | undefined;

export function createQueueConnection(redisUrl: string, opts: RedisOptions = {}): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...opts,
  });
}

export function getSharedConnection(redisUrl: string): Redis {
  if (!sharedConnection || sharedConnection.status === 'end') {
    sharedConnection = createQueueConnection(redisUrl);
  }
  return sharedConnection;
}

export async function closeSharedConnection(): Promise<void> {
  if (sharedConnection && sharedConnection.status !== 'end') {
    await sharedConnection.quit().catch(() => undefined);
  }
  sharedConnection = undefined;
}
