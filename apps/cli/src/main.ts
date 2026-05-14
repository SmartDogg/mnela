#!/usr/bin/env node
//
// `mnela` — operator CLI for a running Mnela install.
//
// Hand-rolled arg parsing instead of commander/cac. Reasons:
//   1. Keeps the cli with zero runtime deps (matches the slim @mnela/cli
//      package.json).
//   2. Most subcommands just `docker compose exec` or shell into a script —
//      flag richness is overkill.
//
// Commands:
//   mnela status              docker compose ps + per-container health
//   mnela logs [svc] [opts]   tail logs (defaults to all services)
//   mnela backup [-o dir]     scripts/backup.sh
//   mnela restore <file>      scripts/restore.sh <file>
//   mnela update [--tag X]    scripts/update.sh (pull latest release + migrate + up)
//   mnela claude:test         POST /system/claude-test on the API
//   mnela providers:export    list configured LLM providers (no plaintext keys)
//   mnela db:audit            pg_stat_statements top queries + index audit
//   mnela help                this listing

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RepoLayout {
  root: string;
  composeFile: string;
  scriptsDir: string;
}

function findRepoLayout(): RepoLayout {
  // When installed as a global bin (`npm i -g`), __dirname is somewhere in
  // a node_modules. Walk up; if no pnpm-workspace.yaml turns up, fall back
  // to cwd. The compose file is the canonical anchor.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return {
        root: dir,
        composeFile: path.join(dir, 'infra/docker/docker-compose.yml'),
        scriptsDir: path.join(dir, 'scripts'),
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cwd = process.cwd();
  return {
    root: cwd,
    composeFile: path.join(cwd, 'infra/docker/docker-compose.yml'),
    scriptsDir: path.join(cwd, 'scripts'),
  };
}

function exitWithUsage(code = 0): never {
  const text = `mnela — operator CLI

Usage:
  mnela <command> [args]

Commands:
  status                 Show docker compose ps with health column
  logs [svc] [--follow]  Tail logs (no svc = all services). Pass extra
                         flags after -- to forward them to docker compose logs.
  backup [-o <dir>]      Run scripts/backup.sh
  restore <file>         Run scripts/restore.sh <file>
  update [--tag X]       Pull latest release, run migrations, restart prod stack
  claude:test            POST /system/claude-test against the API container
  providers:export       Print LlmProvider rows as JSON (no plaintext keys)
  db:audit               pg_stat_statements top queries + missing/unused indexes
  help, -h, --help       Show this message

Environment:
  COMPOSE_FILE           Override docker-compose.yml path
  COMPOSE_PROJECT_NAME   Override project name (default: mnela)
`;
  process.stdout.write(text);
  process.exit(code);
}

function runCompose(layout: RepoLayout, args: string[]): number {
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'mnela';
  const file = process.env.COMPOSE_FILE ?? layout.composeFile;
  const result = spawnSync('docker', ['compose', '-f', file, '-p', project, ...args], {
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`✘ docker not on PATH: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function runScript(script: string, args: string[]): number {
  const layout = findRepoLayout();
  const full = path.join(layout.scriptsDir, script);
  if (!existsSync(full)) {
    process.stderr.write(`✘ script not found: ${full}\n`);
    return 1;
  }
  const result = spawnSync('bash', [full, ...args], {
    stdio: 'inherit',
    cwd: layout.root,
  });
  if (result.error) {
    process.stderr.write(`✘ bash not on PATH: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function cmdStatus(layout: RepoLayout): number {
  return runCompose(layout, ['ps', '--format', 'table {{.Name}}\t{{.State}}\t{{.Status}}']);
}

function cmdLogs(layout: RepoLayout, args: string[]): number {
  const passthrough: string[] = [];
  let service: string | undefined;
  let follow = false;
  for (const a of args) {
    if (a === '--follow' || a === '-f') follow = true;
    else if (a.startsWith('-')) passthrough.push(a);
    else if (!service) service = a;
    else passthrough.push(a);
  }
  return runCompose(layout, [
    'logs',
    follow ? '--follow' : '--tail=200',
    ...passthrough,
    ...(service ? [service] : []),
  ]);
}

function cmdClaudeTest(layout: RepoLayout): number {
  // Exec inside the api container — /system/claude-test is admin-scoped
  // but a loopback call lets us bypass session/bearer auth.
  // TODO(phase-11): once `mnela login` ships, prefer hitting the public
  // origin with the stored bearer token.
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'mnela';
  const file = process.env.COMPOSE_FILE ?? layout.composeFile;
  const inlineScript = `
const http = require('node:http');
const req = http.request({
  host: '127.0.0.1', port: 3000, path: '/api/v1/system/claude-test',
  method: 'POST', headers: { 'content-type': 'application/json' },
}, (res) => {
  let buf = '';
  res.on('data', (c) => { buf += c; });
  res.on('end', () => { process.stdout.write(buf + '\\n'); process.exit(res.statusCode === 200 ? 0 : 1); });
});
req.on('error', (e) => { console.error(e.message); process.exit(1); });
req.end('{}');
`;
  const result = spawnSync(
    'docker',
    ['compose', '-f', file, '-p', project, 'exec', '-T', 'api', 'node', '-e', inlineScript],
    { stdio: 'inherit' },
  );
  return result.status ?? 1;
}

function cmdDbAudit(layout: RepoLayout): number {
  /*
   * Three short reports against the live postgres container:
   *   1. top 20 queries by total exec time (pg_stat_statements)
   *   2. unused indexes (idx_scan = 0, non-unique, non-primary)
   *   3. tables w/ high seq_scan ratio (n_live_tup > 10k AND seq_scan > idx_scan)
   *
   * `CREATE EXTENSION` is idempotent. If `shared_preload_libraries=pg_stat_statements`
   * isn't set in compose, this will fail loudly — that's correct, the
   * operator should restart postgres after pulling the new compose file.
   */
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'mnela';
  const file = process.env.COMPOSE_FILE ?? layout.composeFile;
  const dbUser = process.env.POSTGRES_USER ?? 'mnela';
  const dbName = process.env.POSTGRES_DB ?? 'mnela';
  const sql = `
\\echo ── enabling pg_stat_statements (idempotent) ──
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
\\echo
\\echo ── top 20 queries by total exec time ──
SELECT
  round(total_exec_time::numeric, 1) AS total_ms,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
  regexp_replace(left(query, 120), '\\s+', ' ', 'g') AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
\\echo
\\echo ── unused indexes (idx_scan = 0, drop candidates) ──
SELECT
  schemaname || '.' || relname AS table,
  indexrelname AS index,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i USING (indexrelid)
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 20;
\\echo
\\echo ── hot tables with bad seq/idx ratio (candidate indexes) ──
SELECT
  schemaname || '.' || relname AS table,
  n_live_tup AS rows,
  seq_scan,
  idx_scan,
  CASE WHEN seq_scan = 0 THEN 0
       ELSE seq_tup_read / seq_scan
  END AS avg_seq_read
FROM pg_stat_user_tables
WHERE n_live_tup > 10000
  AND seq_scan > COALESCE(idx_scan, 0)
ORDER BY seq_tup_read DESC NULLS LAST
LIMIT 20;
`;
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      file,
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      dbUser,
      '-d',
      dbName,
      '-c',
      sql,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    process.stderr.write(`✘ docker not on PATH: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function cmdProvidersExport(layout: RepoLayout): number {
  // psql inside the postgres container — avoids needing prisma at the CLI
  // side. Suppress apiKeyEnc; print everything else as a JSON array.
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'mnela';
  const file = process.env.COMPOSE_FILE ?? layout.composeFile;
  const sql = `
    SELECT json_agg(t) FROM (
      SELECT id, name, kind, model, "baseUrl", "apiKeyLast4",
             "createdAt", "updatedAt"
      FROM "LlmProvider"
      ORDER BY "createdAt"
    ) t;
  `;
  const dbUser = process.env.POSTGRES_USER ?? 'mnela';
  const dbName = process.env.POSTGRES_DB ?? 'mnela';
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      file,
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      dbUser,
      '-d',
      dbName,
      '-t',
      '-A',
      '-c',
      sql,
    ],
    { stdio: 'inherit' },
  );
  return result.status ?? 1;
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    exitWithUsage(0);
  }
  const layout = findRepoLayout();
  let code = 1;
  switch (cmd) {
    case 'status':
      code = cmdStatus(layout);
      break;
    case 'logs':
      code = cmdLogs(layout, rest);
      break;
    case 'backup':
      code = runScript('backup.sh', rest);
      break;
    case 'restore':
      if (rest.length === 0) {
        process.stderr.write('Usage: mnela restore <backup.tar.gz>\n');
        process.exit(2);
      }
      code = runScript('restore.sh', rest);
      break;
    case 'update':
      code = runScript('update.sh', rest);
      break;
    case 'claude:test':
      code = cmdClaudeTest(layout);
      break;
    case 'providers:export':
      code = cmdProvidersExport(layout);
      break;
    case 'db:audit':
      code = cmdDbAudit(layout);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      exitWithUsage(2);
  }
  process.exit(code);
}

main();
