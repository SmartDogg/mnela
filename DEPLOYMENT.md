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
- **Hardware (installer):** ≥ 4 GB RAM (8 GB recommended), ≥ 10 GB free disk,
  x86_64 or arm64. The default `MNELA_IMAGES=local` flow builds all six
  service images on the host — pnpm install + tsc each peak ~1 GB RSS. The
  installer builds them sequentially so an 8 GB box is fine; on a 4 GB box
  add a swap file (see VPS prep below).
- **Hardware (running):** ≥ 1 GB RAM is enough once images are built and
  containers are up.
- **Network:** ports 80 + 443 reachable from the public internet (skip if you
  use Cloudflare Tunnel)
- **Domain (recommended):** DNS A record pointing at the VPS IP

## VPS prep (5 minutes before `install.sh`)

The install script handles Docker for you. These are the host-level
steps you typically still want on a fresh VPS:

```bash
# 1. SSH in as root, then update + install basics.
apt update && apt upgrade -y
apt install -y ca-certificates curl ufw fail2ban

# 2. Open the public ports the install script will need.
#    (Cloudflare Tunnel users: skip ufw allow 80/443 — Cloudflare proxies
#    inbound, only outbound 7844 to cloudflared is required.)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 3. (recommended on a 1 GB box) add 2 GB swap so the orchestrator
#    doesn't OOM when a Claude subprocess + ingestion run together.
fallocate -l 2G /swapfile
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 4. Optional: create a non-root sudo user. install.sh itself needs
#    root (`EUID=0`); subsequent `mnela …` calls work fine as a
#    sudo-capable user.
adduser mnela-admin && usermod -aG sudo,docker mnela-admin
```

`fail2ban` is paranoia-mode against SSH brute force. `ufw` (Uncomplicated
Firewall) blocks every port except SSH + 80 + 443. The swap is the
single biggest reliability win on a $5 VPS.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | sudo bash
```

The installer is fully interactive — it re-opens stdin from `/dev/tty`, so
prompts pop up even under `curl | bash`. Pass `--domain`, `--ip`, `--tunnel`,
`--no-claude`, or `-y` to skip individual prompts. `--help` lists them all.

Flow:

1. **Preflight** — installs Docker + `docker compose` (via `get.docker.com`)
   and the host tools `curl git openssl jq` if missing; checks RAM/disk.
2. **Source** — resolves the latest `v*` tag (or `--branch X`), clones into
   `/opt/mnela` if you're not already inside a checkout.
3. **Configuration** — three arrow-key questions: bind mode (domain/IP/tunnel),
   the host value, and Claude Max yes/no. Any value pre-filled via flag is
   skipped.
4. **Review** — a summary of every answer; confirm or abort.
5. **Provisioning** — six sub-steps under `[1/6]`…`[6/6]` progress lines:
   - `.env` with `openssl rand -hex 32` secrets (`chmod 600`)
   - Matching `infra/caddy/Caddyfile.*.template` → `./Caddyfile`
   - Image build — sequential per-service `docker compose … build $svc` to
     avoid OOMing 8 GB hosts (BuildKit parallel can peak past memory).
     Tail of each build lands in `${REPO_ROOT}/.install-logs/build-<svc>.log`.
   - (IP mode only) self-signed TLS cert generated via a one-shot
     `alpine + openssl` container and stashed in the `mnela-caddy-data`
     volume — Caddy reads it as `/data/cert.pem` + `/data/key.pem`. We
     skip `tls internal` because Caddy 2.11's handshake for raw-IP site
     names is unreliable across container restarts.
   - `--profile migrate run --rm migrate` to apply Prisma migrations
   - `--profile prod up -d`, then `node scripts/issue-bootstrap-token.mjs`
     inside the api container so tg-bot can authenticate.
6. **Claude Max OAuth (inline)** — if you answered yes, the installer waits
   for the orchestrator's `claude` CLI to come up, then runs `claude login`
   attached to your terminal. Anthropic prints a one-time URL → open it on
   your workstation → paste the token back. Credentials land in the
   `mnela-claude-creds` volume; backups round-trip it. Pass `--no-claude-login`
   to skip and do it manually later.
7. **Done** — prints the public URL, next-steps, and an operator cheatsheet.

## After install

### 1. Open `/setup` in a browser

The wizard creates the first admin (`POST /auth/bootstrap` — 12-char password
minimum) and then walks you through brain name / timezone / Claude / modules /
MCP token.

### 2. Claude Max (only if you skipped the inline OAuth)

The installer signs you in during step 6 above. If you passed
`--no-claude-login`, hit Ctrl-C during the OAuth, or want to re-do it:

```bash
docker exec -it mnela-orchestrator claude login
```

To verify a successful sign-in any time:

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
Ingestion` and click **Restart Services**. After the Phase-10 hot-reload
work the api / orchestrator / worker all re-bind on the click; no
container restart needed (`api.rateLimit.*` included).

### Hard memory limits (optional, recommended on tiny boxes)

Add `mem_limit:` per service if a single rogue process must never OOM
the host. Drop the following into an override file
`infra/docker/docker-compose.limits.yml`:

```yaml
services:
  postgres: { mem_limit: 512m }
  redis: { mem_limit: 256m }
  api: { mem_limit: 512m }
  web: { mem_limit: 384m }
  worker: { mem_limit: 1g }
  orchestrator: { mem_limit: 1g }
  tg-bot: { mem_limit: 256m }
  mcp: { mem_limit: 256m }
  caddy: { mem_limit: 128m }
```

Then bring up with `-f docker-compose.yml -f docker-compose.limits.yml`.
Tune for your hardware — the numbers above are conservative for a 4 GB
VPS. Containers exceeding their limit are SIGKILL'd by the kernel; the
`unless-stopped` restart policy bounces them back up.

## What's NOT yet auto-managed

- TLS renewal: handled by Caddy automatically for `domain` mode. For
  `tunnel` mode Cloudflare handles TLS. For `ip` mode, install.sh mints
  a 10-year self-signed cert into the `mnela-caddy-data` volume; browsers
  will warn until you import it as a trusted root. To extract:
  `docker run --rm -v mnela-caddy-data:/d alpine cat /d/cert.pem > mnela.crt`,
  then import `mnela.crt` per your OS's trust-store instructions.
- Log rotation: docker daemon defaults apply. Add `log-opts` to
  `/etc/docker/daemon.json` if disk pressure becomes an issue.
- Sentry: not wired (Phase 11). Stack traces live in `mnela logs`.
