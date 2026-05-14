# Deploying Mnela on a fresh VPS

This is the production install guide. For local development read `README.md` →
"Development" instead — `pnpm dev` against `docker compose up postgres redis`
keeps working unchanged. The prod path is purely additive.

## What you'll get

A single VPS running 7 long-lived containers (postgres, redis, api, web,
worker, orchestrator, tg-bot) plus a Caddy reverse proxy that terminates
HTTPS at `https://your-domain.com`. The Setup Wizard runs at `/setup` and
creates the first admin via `POST /auth/bootstrap`.

## Requirements

- **OS:** Ubuntu 22.04 / 24.04, Debian 12, or anything with `apt` + Docker
- **Hardware:** ≥ 1 GB RAM, ≥ 10 GB free disk, x86_64 or arm64
- **Network:** ports 80 + 443 reachable from the public internet (skip if you
  use Cloudflare Tunnel)
- **Domain (recommended):** DNS A record pointing at the VPS IP

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | sudo bash
```

The script will:

1. Install Docker + `docker compose` if missing (via `get.docker.com`).
2. Ask whether you're binding via **domain**, raw **IP**, or **Cloudflare Tunnel**.
3. Ask whether you have a **Claude Max** subscription you can sign into.
4. Clone the repo to `/opt/mnela` (skip if already inside a checkout).
5. Generate `/opt/mnela/.env` with `openssl rand -hex 32` secrets — `chmod 600`.
6. Copy the appropriate `infra/caddy/Caddyfile.*.template` to `./Caddyfile`.
7. Pull pinned images from GHCR (or build locally if `MNELA_IMAGES=local` in `.env`).
8. `docker compose --profile prod up -d` and apply database migrations.
9. Print the URLs.

## After install

### 1. Open `/setup` in a browser

The wizard creates the first admin (`POST /auth/bootstrap` — 12-char password
minimum) and then walks you through brain name / timezone / Claude / modules /
MCP token.

### 2. Bootstrap Claude Max (if you chose `yes`)

```bash
docker exec -it mnela-orchestrator claude login
```

Anthropic prints a one-time URL. Open it on your workstation, finish the
OAuth flow. The credentials land in the `mnela-claude-creds` volume and
survive `docker compose down/up` cycles. To verify:

```bash
docker exec mnela-orchestrator claude --version
mnela claude:test
```

### 3. Configure providers (if you chose `no` to Claude Max)

The wizard pre-expands the **AI Providers** card on `/admin/system`. Add an
Anthropic API key, OpenAI / DeepSeek / Grok / Gemini / OpenRouter, or point
at a local Ollama / LM Studio endpoint. Per-feature routing lives under the
same card.

### 4. Daily backups

The install script suggests a cron line; copy-paste:

```bash
(crontab -l 2>/dev/null; echo "0 4 * * * cd /opt/mnela && bash scripts/backup.sh >> /var/log/mnela-backup.log 2>&1") | crontab -
```

Backups land in `/opt/mnela/backups/mnela-<timestamp>.tar.gz`. The bundle
includes:

- `pg_dump` of the database
- `/data` volume (uploads, vault, dropbox, **keystore/provider.key**)
- `/home/mnela/.claude` from the orchestrator (best-effort)

**Off-host copy is on you.** scp / rclone / restic to a different machine —
a VPS that loses its disk takes your backups with it.

## Updating

```bash
cd /opt/mnela
git pull origin main
docker compose -f infra/docker/docker-compose.yml -p mnela --profile prod pull
docker compose -f infra/docker/docker-compose.yml -p mnela --profile prod up -d
```

To pin a specific release, set `MNELA_VERSION=v0.1.0` in `.env` before pulling.

## Moving to a new host

```bash
# On the OLD host:
bash scripts/backup.sh
scp backups/mnela-<ts>.tar.gz new-host:/tmp/

# On the NEW host:
curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | sudo bash
# ...let install.sh finish, then:
bash scripts/restore.sh /tmp/mnela-<ts>.tar.gz
```

`restore.sh` verifies that the bundled `keystore/provider.key` decrypts at
least one `LlmProvider.apiKeyEnc` row before importing the SQL dump. If
the check fails (different keystore on each host) it stops and asks for
`--skip-keystore-check` — proceed only if you understand the consequence
(every saved provider API key + the Telegram bot token will need to be
re-entered).

## Cloudflare Tunnel variant

```bash
# Pick "tunnel" when install.sh asks, then in a separate step:
docker run -d --name cloudflared --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run \
  --token "$CF_TUNNEL_TOKEN"
```

In the Cloudflare dashboard, route your public hostname to
`http://localhost:80`. Caddy is already configured with `auto_https off` for
this case.

## Operational basics

```bash
mnela status            # docker compose ps
mnela logs api -f       # tail one service
mnela logs              # tail everything
mnela backup            # one-off backup
mnela restore foo.tar.gz
mnela claude:test       # POST /system/claude-test
mnela providers:export  # all LlmProvider rows as JSON (no plaintext keys)
```

`mnela` lives in `apps/cli` and wraps `docker compose` calls + the bash
scripts.

## Living dev install alongside prod

You can run `pnpm dev` against the same `postgres` + `redis` containers
`--profile prod` brought up — they're profile-less in the compose file, so
they don't disappear when you `--profile prod down`. Just keep the prod
api/web/etc stopped while you develop, otherwise you'll fight for the
postgres connection pool.

## Memory + disk operations

Containers cap memory implicitly via Docker's defaults. If you run on a 1 GB
VPS and BullMQ stalls, drop the worker concurrency in `/admin/system →
Ingestion` and click **Restart Services**. The api/orchestrator have no
hot-reload subscriber yet (PLAN.md Phase 11 / Bucket B); for those `docker
compose restart api orchestrator` is still the way to apply the change.

## What's NOT yet auto-managed

- TLS renewal: handled by Caddy automatically for `domain` mode. For
  `tunnel` mode Cloudflare handles TLS. For `ip` mode, browsers will warn
  on the self-signed cert — import `/data/caddy/pki/authorities/local/root.crt`
  from the `mnela-caddy-data` volume as a trusted root.
- Log rotation: docker daemon defaults apply. Add `log-opts` to
  `/etc/docker/daemon.json` if disk pressure becomes an issue.
- Sentry: not wired (Phase 11). Stack traces live in `mnela logs`.
