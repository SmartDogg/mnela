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

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela exec api \
  node node_modules/@mnela/db/node_modules/.bin/prisma migrate deploy \
  --schema=node_modules/@mnela/db/prisma/schema.prisma
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
QUESTIONS.md).

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
subsequent call returns 403. Use `/login` instead. If you lost the
password, drop the row manually:

```bash
docker compose -f infra/docker/docker-compose.yml -p mnela exec postgres \
  psql -U mnela -d mnela -c 'DELETE FROM "AdminUser";'
```

Now `/setup` works again — but every session is invalidated.

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
