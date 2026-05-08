import { execSync } from 'node:child_process';
import path from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const DB_PACKAGE = path.join(REPO_ROOT, 'packages/db');

let postgres: StartedTestContainer | undefined;
let redis: StartedTestContainer | undefined;

beforeAll(async () => {
  const useExisting =
    process.env['CI'] === 'true' && process.env['DATABASE_URL'] && process.env['REDIS_URL'];

  if (!useExisting) {
    postgres = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'mnela',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'mnela',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const dbHost = postgres.getHost();
    const dbPort = postgres.getMappedPort(5432);
    process.env['DATABASE_URL'] = `postgresql://mnela:test@${dbHost}:${dbPort}/mnela?schema=public`;

    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    process.env['REDIS_URL'] = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  }

  process.env['NODE_ENV'] = 'test';
  process.env['MNELA_LOG_LEVEL'] = 'warn';
  process.env['MNELA_DATA_DIR'] = path.join(REPO_ROOT, 'apps/orchestrator/.test-data');
  process.env['MNELA_CLAUDE_AVAILABLE_CHECK'] = 'always-true';

  execSync('pnpm exec prisma migrate deploy', {
    cwd: DB_PACKAGE,
    env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL']! },
    stdio: 'pipe',
  });
}, 240_000);

afterAll(async () => {
  await postgres?.stop().catch(() => undefined);
  await redis?.stop().catch(() => undefined);
});
