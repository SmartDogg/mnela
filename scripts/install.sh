#!/usr/bin/env bash
#
# scripts/install.sh — one-command Mnela install on a fresh Linux VPS.
#
# Idempotent: re-running won't overwrite an existing .env or running
# containers. To start from scratch, `docker compose down -v` first
# (warning: this drops postgres + all uploads).
#
# Curl-pipe-bash convention:
#   curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | bash
# That mode auto-clones to /opt/mnela. If the script is already inside a
# git checkout (you ran `git clone` first), it uses the local checkout.
#
# Style: defensive, single-purpose, no source-tree assumptions until the
# clone happens.

set -euo pipefail

INSTALL_PREFIX=${INSTALL_PREFIX:-/opt/mnela}
REPO_URL=${MNELA_REPO_URL:-https://github.com/SmartDogg/mnela}
REPO_BRANCH=${MNELA_REPO_BRANCH:-main}

cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }

abort() { red "✘ $*"; exit 1; }

prompt() {
  # prompt VARNAME "Question" "default"
  local var="$1" question="$2" default="${3:-}"
  if [[ -n "${!var:-}" ]]; then return; fi    # already set in env
  if ! tty -s; then
    printf -v "$var" '%s' "$default"
    return
  fi
  local input
  if [[ -n "$default" ]]; then
    read -r -p "$question [$default]: " input
    printf -v "$var" '%s' "${input:-$default}"
  else
    read -r -p "$question: " input
    printf -v "$var" '%s' "$input"
  fi
}

prompt_choice() {
  # prompt_choice VARNAME "Question" "opt1|opt2|opt3" "default"
  local var="$1" question="$2" choices="$3" default="$4"
  if [[ -n "${!var:-}" ]]; then return; fi
  if ! tty -s; then printf -v "$var" '%s' "$default"; return; fi
  local input
  while :; do
    read -r -p "$question ($choices) [$default]: " input
    input="${input:-$default}"
    [[ "|$choices|" == *"|$input|"* ]] && break
    yellow "  please pick one of: $choices"
  done
  printf -v "$var" '%s' "$input"
}

# ----- preflight ---------------------------------------------------------
cyan "▸ Mnela install — preflight"
[[ "$EUID" -eq 0 ]] || abort "run as root (or via sudo)."

# We need a recent docker + compose + curl + git + openssl. Install missing.
need_apt_install=()
command -v curl >/dev/null 2>&1 || need_apt_install+=(curl)
command -v git >/dev/null 2>&1 || need_apt_install+=(git)
command -v openssl >/dev/null 2>&1 || need_apt_install+=(openssl)
command -v jq >/dev/null 2>&1 || need_apt_install+=(jq)
command -v ca-certificates >/dev/null 2>&1 || true

if (( ${#need_apt_install[@]} > 0 )); then
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${need_apt_install[@]}"
  else
    abort "missing tools: ${need_apt_install[*]} — install them manually then re-run."
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  yellow "  docker not found — installing via get.docker.com"
  curl -fsSL https://get.docker.com | sh
fi
docker version >/dev/null 2>&1 || abort "docker daemon is not running; start it with 'systemctl start docker'"
docker compose version >/dev/null 2>&1 || abort "docker compose plugin missing. On Debian/Ubuntu: apt install docker-compose-plugin"

# Disk / memory sanity. 1 GB RAM minimum, 10 GB free.
MEM_KB=$(grep -E '^MemTotal' /proc/meminfo | awk '{print $2}')
(( MEM_KB > 700000 )) || yellow "  ⚠ <1 GB RAM detected ($((MEM_KB/1024)) MB) — Mnela may be slow."
DISK_FREE_KB=$(df -k --output=avail / | tail -n1)
(( DISK_FREE_KB > 10000000 )) || yellow "  ⚠ <10 GB free disk."

# ----- clone (or reuse local checkout) -----------------------------------
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/../infra/docker/docker-compose.yml" ]]; then
  REPO_ROOT=$(cd "$SELF_DIR/.." && pwd)
  cyan "▸ Using local checkout at $REPO_ROOT"
else
  if [[ -d "$INSTALL_PREFIX/.git" ]]; then
    cyan "▸ Updating $INSTALL_PREFIX"
    git -C "$INSTALL_PREFIX" fetch --depth=1 origin "$REPO_BRANCH"
    git -C "$INSTALL_PREFIX" checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH"
  else
    cyan "▸ Cloning $REPO_URL into $INSTALL_PREFIX"
    mkdir -p "$INSTALL_PREFIX"
    git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_PREFIX"
  fi
  REPO_ROOT="$INSTALL_PREFIX"
fi
cd "$REPO_ROOT"

# ----- interactive config ------------------------------------------------
cyan "▸ Configuration"
prompt_choice MNELA_BIND_MODE \
  "  How do you want to reach this Mnela?" \
  "domain|ip|tunnel" \
  "domain"

case "$MNELA_BIND_MODE" in
  domain)
    prompt MNELA_DOMAIN "  Public domain (e.g. mnela.example.com)" ""
    [[ -n "$MNELA_DOMAIN" ]] || abort "domain mode needs a non-empty domain."
    MNELA_PUBLIC_ORIGIN="https://$MNELA_DOMAIN"
    CADDY_TEMPLATE="infra/caddy/Caddyfile.domain.template"
    ;;
  ip)
    prompt MNELA_HOST "  Public IP or hostname" "$(hostname -I | awk '{print $1}')"
    MNELA_PUBLIC_ORIGIN="https://$MNELA_HOST"
    CADDY_TEMPLATE="infra/caddy/Caddyfile.ip.template"
    ;;
  tunnel)
    prompt MNELA_DOMAIN "  Cloudflare-Tunnel hostname (e.g. mnela.example.com)" ""
    [[ -n "$MNELA_DOMAIN" ]] || abort "tunnel mode needs the public hostname Cloudflare routes to localhost:80."
    MNELA_PUBLIC_ORIGIN="https://$MNELA_DOMAIN"
    CADDY_TEMPLATE="infra/caddy/Caddyfile.tunnel.template"
    ;;
esac

prompt_choice CLAUDE_MAX \
  "  Do you have a Claude Max subscription you can sign into for built-in enrichment?" \
  "yes|no" \
  "yes"

# ----- generate secrets + .env ------------------------------------------
gensecret() { openssl rand -hex 32; }

ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cyan "▸ Generating $ENV_FILE (chmod 600)"
  POSTGRES_PASSWORD=$(gensecret)
  REDIS_PASSWORD=$(gensecret)
  COOKIE_SECRET=$(gensecret)
  PROVIDER_SECRET=$(gensecret)
  INTERNAL_TOKEN="mn_$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)"

  cat >"$ENV_FILE" <<EOF
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ENV=production

# Domain / IP / tunnel
MNELA_BIND_MODE=$MNELA_BIND_MODE
MNELA_DOMAIN=${MNELA_DOMAIN:-localhost}
MNELA_HOST=${MNELA_HOST:-localhost}
MNELA_PUBLIC_ORIGIN=$MNELA_PUBLIC_ORIGIN

# Postgres
POSTGRES_USER=mnela
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mnela
POSTGRES_PORT=5432
DATABASE_URL=postgresql://mnela:$POSTGRES_PASSWORD@localhost:5432/mnela?schema=public

# Redis
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_PORT=6379
REDIS_URL=redis://default:$REDIS_PASSWORD@localhost:6379

# Auth
COOKIE_SECRET=$COOKIE_SECRET
SESSION_TTL_SECONDS=604800

# Mnela data dir (mounted as the mnela-data volume in containers).
MNELA_DATA_DIR=/data
MNELA_LOG_LEVEL=info

# AES-256-GCM master key for the encrypted-secret keystore (provider API
# keys + Telegram bot token). DO NOT rotate without re-encrypting every
# encrypted row — losing this value makes them unreadable. backup.sh and
# restore.sh both round-trip through it.
MNELA_PROVIDER_SECRET=$PROVIDER_SECRET

# Bearer token apps/tg-bot uses for its own calls into apps/api. Scope mcp.
MNELA_INTERNAL_TOKEN=$INTERNAL_TOKEN

# Image source: 'local' builds from this checkout (works for fresh OSS
# users on any commit). Flip to 'registry' once a GHCR release exists
# for your target MNELA_VERSION — then `mnela update` pulls instead of
# rebuilding. release.yml in .github/workflows publishes per-tag.
MNELA_IMAGES=local
MNELA_VERSION=latest

# Caddy port mapping (80/443 by default; change only if something else
# already binds them on the host).
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
EOF
  chmod 600 "$ENV_FILE"
else
  yellow "▸ $ENV_FILE already exists — keeping. Edit by hand to change values."
fi

# Re-load for our own use below.
set -a; . "$ENV_FILE"; set +a

# ----- materialise Caddyfile --------------------------------------------
cp "$CADDY_TEMPLATE" "$REPO_ROOT/Caddyfile"
green "  Caddyfile: $CADDY_TEMPLATE → $REPO_ROOT/Caddyfile"

# ----- pull / build + up -------------------------------------------------
cyan "▸ Bringing up Mnela ($MNELA_IMAGES mode)"
COMPOSE="docker compose -f infra/docker/docker-compose.yml -p mnela"

if [[ "$MNELA_IMAGES" == "registry" ]]; then
  $COMPOSE --profile prod pull
  $COMPOSE --profile prod up -d
else
  $COMPOSE --profile prod up -d --build
fi

# ----- migrations --------------------------------------------------------
cyan "▸ Applying database migrations"
# Wait for the api container to settle so prisma sees a healthy db.
sleep 5
$COMPOSE exec -T api node \
  ./node_modules/@mnela/db/node_modules/.bin/prisma migrate deploy \
  --schema=./node_modules/@mnela/db/prisma/schema.prisma 2>/dev/null \
  || yellow "  migrations not run from the api image (no prisma binary bundled)."
yellow "  if migrations didn't apply, run them manually once:"
yellow "    $COMPOSE exec api node ./node_modules/@mnela/db/scripts/migrate.js"

# ----- done --------------------------------------------------------------
green "✓ Mnela is up"
cat <<EOF

  Web UI:    $MNELA_PUBLIC_ORIGIN
  Setup:     $MNELA_PUBLIC_ORIGIN/setup
  Health:    $MNELA_PUBLIC_ORIGIN/api/v1/system/health

Next steps:
  1. Open $MNELA_PUBLIC_ORIGIN/setup in a browser. Step 1 creates the first
     admin via POST /auth/bootstrap (password ≥ 12 chars).

EOF

if [[ "$CLAUDE_MAX" == "yes" ]]; then
  cat <<EOF
  2. Bootstrap your Claude Max login (one-time, persisted in a volume):
       docker exec -it mnela-orchestrator claude login
     Anthropic will print a URL — open it on your workstation, finish the
     OAuth flow, then come back to the wizard's "Modules" step.

EOF
else
  cat <<EOF
  2. In the wizard, skip the Claude Max step and continue to /admin/system →
     AI Providers to add an Anthropic API key, OpenAI / DeepSeek / Grok /
     Gemini / OpenRouter, or a local Ollama / LM Studio endpoint.

EOF
fi

cat <<EOF
  3. Schedule daily backups:
       (crontab -l 2>/dev/null; echo "0 4 * * * cd $REPO_ROOT && bash scripts/backup.sh >> /var/log/mnela-backup.log 2>&1") | crontab -

  Logs:    docker compose -f infra/docker/docker-compose.yml -p mnela logs -f
  Stop:    docker compose -f infra/docker/docker-compose.yml -p mnela --profile prod down
  Backup:  bash scripts/backup.sh
EOF
