# Mnela troubleshooting

Quick checks before opening an issue.

## Health probe

```bash
curl -fsS https://your-domain.com/api/v1/system/health
# {"status":"ok","db":true,"redis":true}
```

If `status` is `degraded`, look at `db` / `redis`:

- `db: false` → postgres is down or the api can't reach it. `mnela logs api`.
- `redis: false` → redis is down, has the wrong password, or the api is using
  the wrong URL. Check `REDIS_URL` in `.env`.

---

## `claude` CLI not found inside the orchestrator

The orchestrator image installs `claude` via the Anthropic native installer.
If it's missing, the build silently failed:

```bash
docker exec mnela-orchestrator which claude
# /home/mnela/.local/bin/claude
docker exec mnela-orchestrator claude --version
```

If both fail, rebuild the image:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela build --no-cache orchestrator
docker compose -f infra/docker/docker-compose.yml -p mnela --profile prod up -d orchestrator
```

To pin a specific Claude version, add `--build-arg CLAUDE_INSTALL_REF=2.x.y`.

## `claude login` won't persist

Credentials live in the `mnela-claude-creds` named volume. If `docker volume
ls | grep claude` is empty, the volume wasn't created — the compose file's
`volumes:` block probably wasn't applied. Re-run `--profile prod up -d` and
re-login.

If you're cloning between hosts and Anthropic returns "session expired",
just re-login on the new host — backups do their best to capture the
credentials but Anthropic may have rotated.

## Whisper port not reachable

`WHISPER_URL=http://whisper:8080` (the container DNS name) only resolves
inside the compose network. From `pnpm dev` on the host, use
`WHISPER_URL=http://127.0.0.1:8090` and the `docker-compose.whisper-host.yml`
overlay (see comments in `.env.example`).

## `redis NOAUTH Authentication required`

`REDIS_URL` must include the password as the `default` user. Right shape:

```
REDIS_URL=redis://default:<password>@redis:6379
```

`redis://<password>@redis:6379` (without `default:`) does NOT work — Redis
7 requires a username.

## Migration failed during install

The default `[4/6]` migrate step runs the dedicated `migrate` compose
service; if it crashed mid-way you can retry it directly. Caveats:

- `node_modules/.bin/prisma` only exists when `prisma` is a _direct_ dep
  of the deploy target. It is in `apps/api`'s deps as of v1.0.0, so the
  symlink is present in the api image. If you're on an older build,
  resolve the CLI through Node's resolver instead:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela exec api \
  node -e 'console.log(require.resolve("prisma/build/index.js"))'
# /app/node_modules/.pnpm/prisma@…/node_modules/prisma/build/index.js

docker compose -f infra/docker/docker-compose.yml -p mnela exec api \
  node /app/node_modules/.pnpm/prisma@…/node_modules/prisma/build/index.js \
  migrate deploy --schema=node_modules/@mnela/db/prisma/schema.prisma
```

For a clean re-run, prefer the migrate service:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela \
  --profile migrate run --rm migrate
```

If that fails with `permission denied for schema public`, your `POSTGRES_USER`
isn't the schema owner. Connect as `postgres` and `GRANT ALL ON SCHEMA public
TO mnela;`.

## Backup tarball is huge

The `/data` volume includes everything users have uploaded plus the
generated vault. Exclude the dropbox watch directory if you keep large
ingestion sources there:

```bash
# Edit scripts/backup.sh — between the alpine tar and the > redirect,
# add `--exclude=./dropbox/big-folder` flags.
```

Long-term: split attachments off to S3/B2 (post-Phase 11 work — see
[`docs/dev/QUESTIONS.md`](./docs/dev/QUESTIONS.md)).

## `docker compose down -v` ate my data

**Warning** for the record: `-v` removes named volumes. The `mnela-postgres-data`,
`mnela-data`, `mnela-claude-creds` volumes are all destroyed. There is no
"undo".

If you have backups (you do, right?) `mnela restore <file>` brings everything
back. If not — sorry.

To stop containers WITHOUT destroying volumes:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela --profile prod down
# NOT down -v
```

## Caddy can't get a Let's Encrypt cert

- Confirm DNS resolves to the right IP: `dig +short your-domain.com`
- Confirm ports 80 + 443 are reachable from the public internet:
  `curl -fsS http://your-domain.com/api/v1/system/health` from another host.
- Check Caddy logs: `mnela logs caddy -f`. Common cause: port 80 already
  bound by another service (nginx, apache).

## Restart Services button doesn't apply changes

`api` and `orchestrator` don't yet subscribe to the `system.service_reload`
pubsub channel. For changes that affect those processes
(`enrichment.parallelism`, `api.rateLimit.*`, `search.*`) run a real restart
of the affected container:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela restart api
docker compose -f infra/docker/docker-compose.yml -p mnela restart orchestrator
```

Hot-reload coverage for those processes is tracked as Phase 11 / Bucket B.

## `mnela` command not found

`apps/cli` builds to `apps/cli/dist/main.js` and exposes the `mnela` bin via
its package.json. On a prod install you can either:

```bash
# A. Run from the repo root (the script auto-resolves paths)
node /opt/mnela/apps/cli/dist/main.js status

# B. Symlink globally
ln -s /opt/mnela/apps/cli/dist/main.js /usr/local/bin/mnela
chmod +x /usr/local/bin/mnela
```

## Setup Wizard says "An admin already exists"

`POST /auth/bootstrap` is single-shot — once any admin user exists, every
subsequent call returns 403. The wizard from v1.0.0 onward detects this
on mount via `/auth/setup-status` and skips ahead, so you only hit the
literal 403 if you race the redirect. Use `/login` instead.

If you lost the admin password, drop the row manually:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela exec postgres \
  psql -U mnela -d mnela -c 'DELETE FROM "AdminUser";'
```

Now `/setup` works again — but every existing session is invalidated.

## Telegram bot не отвечает на сообщения

**Симптом.** Бот в Telegram молчит на любые сообщения; в логах
`mnela-tg-bot` повторяющиеся `401 Unauthorized` от api или crash-loop
по `MNELA_INTERNAL_TOKEN must be at least 20 chars`.

**Причина.** apps/tg-bot ходит в apps/api как Bearer `MNELA_INTERNAL_TOKEN`.
API ищет в БД запись `AuthToken.tokenHash = sha256(token)`. Если строки
нет — все вызовы 401. Это случается когда:

1. install.sh запускался до 2026-05 (без `apps/api/scripts/issue-bootstrap-token.mjs`).
2. `MNELA_INTERNAL_TOKEN` был ротирован в `.env`, но в БД остался старый hash.
3. Запись `AuthToken` была отозвана (`revokedAt IS NOT NULL`).

**Лечение.**

```bash
# Из репо-рута. Перевыпускает запись, идемпотентно.
docker compose -f infra/docker/docker-compose.yml -p mnela exec -T \
  -e MNELA_INTERNAL_TOKEN="$(grep ^MNELA_INTERNAL_TOKEN= .env | cut -d= -f2-)" \
  api node scripts/issue-bootstrap-token.mjs

docker compose -f infra/docker/docker-compose.yml -p mnela restart tg-bot
```

Если ротируете `MNELA_INTERNAL_TOKEN` сами — сначала отзовите старую
запись через `/admin/system → API tokens`, потом обновите `.env`, потом
выполните команду выше.

## Web показывает "Runtime TypeError: fetch failed" на любой странице

**Симптом.** Любая страница на :3001 падает с `serverFetch / fetch failed`
в трейсе. Health-чек api при этом отвечает 200.

**Причина — одна из двух.**

1. **api-процесс не запущен** (typical post-pnpm-dev). Проверь:

   ```bash
   curl -sf http://localhost:3000/api/v1/system/health || echo "api down"
   ```

2. **`MNELA_API_INTERNAL_BASE` без суффикса `/api/v1`** (был баг до
   2026-05-15). `apps/web/src/lib/api/server.ts` конкатит относительные
   пути вида `/auth/me` к base. Без суффикса получается
   `http://api:3000/auth/me` → 404. В compose должно быть
   `MNELA_API_INTERNAL_BASE: http://api:3000/api/v1`.

**Лечение.**

```bash
# Перезапустить api в dev:
pnpm --filter @mnela/api dev

# Или production:
docker compose -f infra/docker/docker-compose.yml -p mnela restart api web

# Если фиксили compose:
grep MNELA_API_INTERNAL_BASE infra/docker/docker-compose.yml
# должно быть http://api:3000/api/v1
```

## "MCP config file not found" in orchestrator logs

The orchestrator generates `${MNELA_DATA_DIR}/claude/claude-mcp-config.json`
at boot via `apps/orchestrator/src/mcp/mcp-config.boot.ts`. If the file is
missing, the volume wasn't writable. Check ownership:

```bash
docker exec mnela-orchestrator ls -la /data/claude/
```

The `mnela` user inside the container needs to own `/data`. The Dockerfile
chowns at build time, but if you've manually swapped a bind-mount in,
re-chown to the container's `mnela:mnela`.

## Enabling optional Sentry crash reporting

Sentry is off by default and `@sentry/node` is intentionally not bundled
in the slim Docker images. To turn it on:

```bash
# 1. add the dep (workspace-scoped install)
pnpm add @sentry/node -F @mnela/api -F @mnela/worker \
                     -F @mnela/orchestrator -F @mnela/tg-bot

# 2. set the DSN in .env
echo 'MNELA_SENTRY_DSN=https://…@sentry.io/…' >> .env

# 3. rebuild prod images and restart
mnela update
```

`packages/core/src/sentry.ts` dynamic-imports the package and scrubs
`Authorization` headers and request bodies in `beforeSend`. If the DSN
is set but the package isn't installed, the process stderr-logs once
and continues without telemetry.

## Postgres index audit (`mnela db:audit`)

Run on a populated install to find slow queries + drop-candidate
indexes:

```bash
mnela db:audit
```

If you get `ERROR: relation "pg_stat_statements" does not exist`, the
extension hasn't been preloaded yet — that happens once after pulling
the new compose file. `mnela update` already includes the postgres
restart; if you started from an older deployment, run:

```bash
docker compose up -d postgres   # picks up the new shared_preload_libraries
mnela db:audit
```

See [`docs/PERF.md`](./docs/PERF.md) for what to do with the output.

## Symptoms specific to pre-v1.0.0 builds

These all fall away on a fresh v1.0.0 install. If you're upgrading an
older deployment and hit one, pull `main` and rebuild the affected
service.

- **`/setup` returns 500 with `ECONNREFUSED 127.0.0.1:3000`** — Next.js
  rewrites used to bake `apiOrigin` at build time. Fixed by terminating
  `/_api/*` at Caddy (see `infra/caddy/Caddyfile.*.template`). After
  pulling, rebuild web _or_ just patch the Caddyfile and reload Caddy.
- **`api` / `worker` / `orchestrator` in restart loop with `Prisma Client
did not initialize yet`** — `pnpm deploy --prod` drops the generator's
  `.prisma/client/` output. Fixed by re-running `prisma generate` inside
  `/out` in each Dockerfile. Rebuild affected images.
- **`api` crashes with `EACCES: mkdir '/backups/.incoming'`** — the api
  image now `mkdir -p /backups && chown mnela:mnela /backups` so the
  volume mount inherits writable perms. Rebuild api.
- **Caddy `TLS alert internal error` on IP-mode** — `tls internal` for
  raw IPs failed silently. install.sh now mints a self-signed cert via
  openssl + alpine into the caddy-data volume. Re-run install.sh, or
  generate the cert by hand if you don't want a full re-provision.
- **Installer freezes silently right after `[4/6] prisma migrate deploy`**
  — `docker compose run` was eating the rest of the script piped through
  `curl|bash`. Fixed via `</dev/null` on all docker-compose run/exec
  calls. Pull main and re-run.

## Container healthcheck reports "unhealthy"

Each container has a docker `healthcheck:` configured (see
`infra/docker/docker-compose.yml`):

- **api / web / mcp** — HTTP probe via the node binary. Failure means
  the process is up but not serving — usually a startup crash visible
  in `mnela logs <svc>`.
- **worker / orchestrator / tg-bot** — touches `/tmp/mnela-heartbeat`
  every 30 s; mtime > 90 s old marks the container unhealthy. A wedged
  event loop will trip this even when `restart: unless-stopped`
  wouldn't (the process is alive, just deadlocked).

If a worker keeps tripping the heartbeat, get a profile:

```bash
docker exec mnela-worker node -e "console.log(process._getActiveHandles().length)"
```

A growing handle count is a leak; a stuck event-loop tick is a
deadlock. Either way the cure is a restart followed by file an issue
with `mnela logs worker 500` attached.
