import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

/**
 * Boots the worker NestJS context inside the same Vitest process as the API.
 * Both share the testcontainers postgres + redis from setup.ts.
 *
 * The dynamic import is critical: it ensures the worker's `loadEnv()` (called
 * at module load time) sees the env vars set by setup.ts.
 */
export async function buildTestWorker(): Promise<INestApplicationContext> {
  const { WorkerModule } = await import('../../worker/src/worker.module.js');
  return NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
}
