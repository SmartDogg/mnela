import { execSync } from 'node:child_process';
import path from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const DB_PACKAGE = path.join(REPO_ROOT, 'packages/db');

let postgres: StartedTestContainer | undefined;
let redis: StartedTestContainer | undefined;

function setCommonEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['ADMIN_INITIAL_USERNAME'] = 'admin';
  process.env['ADMIN_INITIAL_PASSWORD'] = 'test_admin_pwd_!1';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa';
  // Tests drive Nest via supertest on the underlying http server (no listen()),
  // so the port is unused — set a syntactically valid value.
  process.env['HTTP_PORT'] = '3999';
  process.env['MNELA_LOG_LEVEL'] = 'warn';
  process.env['MNELA_DATA_DIR'] = path.join(REPO_ROOT, 'apps/api/.test-data');
}

beforeAll(async () => {
  // CI provides postgres+redis as GitHub-Actions services and exports
  // DATABASE_URL/REDIS_URL — skip testcontainers in that case.
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

  setCommonEnv();

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
