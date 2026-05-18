#!/usr/bin/env bash
#
# scripts/install.sh — interactive Mnela installer for a fresh Linux VPS.
#
# Always asks questions, even under `curl | bash`: re-opens stdin from
# /dev/tty when needed. Pass flags to skip individual prompts.
#
#   sudo bash install.sh                                   # full interactive
#   curl -fsSL https://… | sudo bash                       # interactive over curl
#   sudo bash install.sh --domain foo.com --no-claude -y   # silent
#
# Idempotent: .env / Caddyfile from a previous run are kept unless --force.

set -Eeuo pipefail

# A common foot-gun: operators run `rm -rf /opt/mnela` (the install target)
# while their shell is sitting inside it, then re-launch the installer. The
# bash that curl|sudo bash spawns inherits the orphaned cwd, and every child
# git/getcwd call spams "job-working-directory: error retrieving current
# directory" to stderr. Worse: `git ls-remote 2>/dev/null` returns empty in
# that state, so the latest-tag probe silently falls back to `main`. Pin cwd
# to a directory that definitely exists before anything else touches it.
cd / 2>/dev/null || true

# ============================================================================
# 1 — config + terminal capabilities
# ============================================================================

INSTALL_PREFIX=${INSTALL_PREFIX:-/opt/mnela}
REPO_URL=${MNELA_REPO_URL:-https://github.com/SmartDogg/mnela}
REPO_BRANCH=${MNELA_REPO_BRANCH:-}
FORCE=${MNELA_FORCE:-0}
ASSUME_YES=0
SKIP_CLAUDE_LOGIN=0

# `curl … | bash` pipes the script through stdin — bash itself is reading
# the script source from fd 0. We CANNOT `exec </dev/tty` here: that would
# make bash try to read the rest of the script from the user's keyboard,
# which presents as "pure hang, no banner". Instead, open /dev/tty on fd 3
# and have ask_* helpers read with `read -u "$TTY_FD"`.
HAVE_TTY=0
TTY_FD=0
if [[ -t 0 ]]; then
  HAVE_TTY=1
elif [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
  exec 3</dev/tty
  TTY_FD=3
  HAVE_TTY=1
fi

USE_COLORS=1
[[ -t 1 ]] || USE_COLORS=0
[[ -n "${NO_COLOR:-}" ]] && USE_COLORS=0
if (( USE_COLORS )); then
  C0=$'\033[0m'   CB=$'\033[1m'   CD=$'\033[2m'
  CC=$'\033[36m'  CG=$'\033[32m'  CY=$'\033[33m'  CR=$'\033[31m'  CK=$'\033[90m'
else
  C0=""  CB=""  CD=""  CC=""  CG=""  CY=""  CR=""  CK=""
fi

COLS=${COLUMNS:-72}
if command -v tput >/dev/null 2>&1; then
  COLS=$(tput cols 2>/dev/null || echo 72)
fi

# ============================================================================
# 2 — output primitives
# ============================================================================

banner() {
  [[ "$HAVE_TTY" == "1" ]] && { clear 2>/dev/null || true; }
  cat <<EOF

${CC}    ███╗   ███╗ ███╗   ██╗ ███████╗ ██╗      █████╗
    ████╗ ████║ ████╗  ██║ ██╔════╝ ██║     ██╔══██╗
    ██╔████╔██║ ██╔██╗ ██║ █████╗   ██║     ███████║
    ██║╚██╔╝██║ ██║╚██╗██║ ██╔══╝   ██║     ██╔══██║
    ██║ ╚═╝ ██║ ██║ ╚████║ ███████╗ ███████╗██║  ██║
    ╚═╝     ╚═╝ ╚═╝  ╚═══╝ ╚══════╝ ╚══════╝╚═╝  ╚═╝${C0}

       ${CD}Self-hosted personal-knowledge OS${C0}
       ${CK}github.com/SmartDogg/mnela${C0}

EOF
}

section() {
  local title="$1"
  local pad=$(( COLS - ${#title} - 5 ))
  (( pad < 3 )) && pad=3
  printf '\n%s━━ %s%s%s ' "$CC" "$CB" "$title" "$C0$CC"
  printf '━%.0s' $(seq 1 "$pad")
  printf '%s\n\n' "$C0"
}

info()  { printf '    %s%s%s\n' "$CD" "$*" "$C0"; }
ok()    { printf '    %s✓%s %s\n' "$CG" "$C0" "$*"; }
warn()  { printf '    %s⚠%s %s\n' "$CY" "$C0" "$*"; }
err()   { printf '    %s✘%s %s\n' "$CR" "$C0" "$*" >&2; }
step()  { printf '  %s▸%s %s%s%s\n' "$CC" "$C0" "$CB" "$*" "$C0"; }
kv()    { printf '    %s%-22s%s %s%s%s\n' "$CD" "$1" "$C0" "$CB" "$2" "$C0"; }
abort() { __spin_stop; err "$*"; exit 1; }

# ----- spinner (only for genuinely silent operations) -----------------------

__SPID=""
spin() {
  local msg="$*"
  if [[ "$HAVE_TTY" != "1" ]] || (( ! USE_COLORS )); then
    printf '    … %s\n' "$msg"
    return
  fi
  (
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    tput civis 2>/dev/null || true
    while :; do
      i=$(( (i + 1) % 10 ))
      printf '\r    %s%s%s %s' "$CC" "${frames[i]}" "$C0" "$msg"
      sleep 0.08
    done
  ) &
  __SPID=$!
}
__spin_stop() {
  if [[ -n "${__SPID:-}" ]]; then
    kill "$__SPID" 2>/dev/null || true
    wait "$__SPID" 2>/dev/null || true
    __SPID=""
    printf '\r\033[K'
    tput cnorm 2>/dev/null || true
  fi
}
spin_ok()   { __spin_stop; [[ $# -gt 0 ]] && ok "$*"; }
spin_fail() { __spin_stop; err "$*"; exit 1; }

# Run a long, noisy command (docker compose build / up / migrate) behind a
# spinner. stdout+stderr go to "$1" (a log file), the screen stays clean,
# and on failure the last 60 lines of the log are dumped to stderr so the
# operator sees what went wrong without scrolling. Caller passes the label
# as $2 and the command starting from $3.
#   run_quiet "$LOG_DIR/build.log" "building images" docker compose … build
run_quiet() {
  local logfile="$1"; shift
  local label="$1"; shift
  spin "$label  (log: $logfile)"
  # Detach stdin from the child. Critical for `docker compose run` which
  # attaches stdin by default — if this script is being read by bash off
  # the curl pipe, docker would slurp the remaining script text into the
  # migrate container, bash would hit EOF on the next iteration, and the
  # installer would exit silently right after [4/6] without doing [5/6].
  if "$@" </dev/null >"$logfile" 2>&1; then
    spin_ok "$label"
    return 0
  fi
  __spin_stop
  err "$label failed — tail of $logfile:"
  printf '%s\n' "---" >&2
  tail -n 60 "$logfile" >&2 2>/dev/null || true
  printf '%s\n' "---" >&2
  err "full log: $logfile"
  exit 1
}

cleanup() {
  __spin_stop
  tput cnorm 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; err "interrupted"; exit 130' INT TERM

# ============================================================================
# 3 — input primitives
# ============================================================================

# ask_text VAR "Question" "default" [validator_fn]
ask_text() {
  local var="$1" q="$2" default="${3:-}" validator="${4:-}"
  if [[ -n "${!var:-}" ]]; then return; fi
  if [[ "$HAVE_TTY" != "1" ]]; then
    [[ -n "$default" ]] || abort "no TTY and no value for $var — re-run with the matching flag (--help)."
    printf -v "$var" '%s' "$default"
    return
  fi
  local raw
  while :; do
    if [[ -n "$default" ]]; then
      printf '\n  %s?%s %s %s(default: %s)%s\n  %s›%s ' \
        "$CC" "$C0" "$q" "$CD" "$default" "$C0" "$CC" "$C0"
    else
      printf '\n  %s?%s %s\n  %s›%s ' "$CC" "$C0" "$q" "$CC" "$C0"
    fi
    IFS= read -r -u "$TTY_FD" raw
    raw="${raw:-$default}"
    if [[ -z "$raw" ]]; then
      warn "value required"
      continue
    fi
    if [[ -n "$validator" ]] && ! $validator "$raw"; then
      continue
    fi
    printf -v "$var" '%s' "$raw"
    return
  done
}

# ask_menu VAR "Title" "key1|Label one" "key2|Label two" ...
# Arrow-key + numeric + vim (j/k) navigation. Q aborts. Enter confirms.
ask_menu() {
  local var="$1"; shift
  local title="$1"; shift
  if [[ -n "${!var:-}" ]]; then return; fi
  local keys=() labels=()
  local opt
  for opt in "$@"; do
    keys+=("${opt%%|*}")
    labels+=("${opt#*|}")
  done
  local n=${#keys[@]}

  if [[ "$HAVE_TTY" != "1" ]]; then
    abort "no TTY for menu '$title' — re-run with the matching flag (--help)."
  fi

  printf '\n  %s?%s %s%s%s\n' "$CC" "$C0" "$CB" "$title" "$C0"
  printf '    %s↑/↓ or 1-%d · Enter to confirm · q to abort%s\n\n' "$CK" "$n" "$C0"

  # Reserve N lines, then redraw in-place each iteration.
  local i
  for ((i=0;i<n;i++)); do printf '\n'; done

  local sel=0 key esc idx
  tput civis 2>/dev/null || true
  while :; do
    printf '\033[%dA' "$n"
    for ((i=0;i<n;i++)); do
      printf '\033[K'
      if [[ $i -eq $sel ]]; then
        printf '    %s▸ %s%s%s\n' "$CC" "$CB" "${labels[$i]}" "$C0"
      else
        printf '    %s  %s%s\n' "$CK" "${labels[$i]}" "$C0"
      fi
    done

    IFS= read -rsn1 -u "$TTY_FD" key
    case "$key" in
      $'\e')
        IFS= read -rsn2 -t 0.05 -u "$TTY_FD" esc 2>/dev/null || esc=""
        case "$esc" in
          '[A'|'[D') sel=$(( (sel - 1 + n) % n )) ;;
          '[B'|'[C') sel=$(( (sel + 1) % n )) ;;
        esac
        ;;
      ''|$'\n'|$'\r') break ;;
      k|K) sel=$(( (sel - 1 + n) % n )) ;;
      j|J) sel=$(( (sel + 1) % n )) ;;
      [1-9])
        idx=$((10#$key - 1))
        if [[ $idx -lt $n ]]; then sel=$idx; break; fi
        ;;
      q|Q)
        tput cnorm 2>/dev/null || true
        printf '\n'
        abort "aborted by user"
        ;;
    esac
  done
  tput cnorm 2>/dev/null || true

  printf -v "$var" '%s' "${keys[$sel]}"
  printf '\n'
}

# ----- validators -----------------------------------------------------------

v_domain() {
  if [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]; then
    return 0
  fi
  warn "doesn't look like a domain (e.g. mnela.example.com)"
  return 1
}
v_host() {
  if [[ "$1" =~ ^[A-Za-z0-9.:_-]+$ ]]; then
    return 0
  fi
  warn "invalid characters in host"
  return 1
}

# ============================================================================
# 4 — argv
# ============================================================================

print_help() {
  cat <<EOH
Mnela installer — interactive setup for a fresh Linux VPS.

Usage:
  sudo bash install.sh                                  # full interactive run
  curl -fsSL https://… | sudo bash                      # interactive over curl
  sudo bash install.sh --domain mnela.example.com -y    # silent

Flags (any unset value still pops a prompt):
  --domain HOST         bind via Let's Encrypt at HOST
  --ip ADDR             bind via self-signed TLS at ADDR
  --tunnel HOST         bind behind Cloudflare Tunnel
  --no-claude           skip Claude Max (configure API providers later)
  --claude              answer "yes" to Claude Max non-interactively
  --no-claude-login     don't run claude login in-script even if Max=yes
  --branch NAME         install a specific tag/branch (default: latest v*)
  --force               regenerate .env and Caddyfile
  -y, --yes             auto-confirm the Review screen
  -h, --help            show this and exit
EOH
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)            FORCE=1; shift ;;
    -y|--yes)           ASSUME_YES=1; shift ;;
    --branch)           REPO_BRANCH="$2"; shift 2 ;;
    --domain)           MNELA_DOMAIN="$2"; MNELA_BIND_MODE="domain"; shift 2 ;;
    --ip)               MNELA_HOST="$2"; MNELA_BIND_MODE="ip"; shift 2 ;;
    --tunnel)           MNELA_DOMAIN="$2"; MNELA_BIND_MODE="tunnel"; shift 2 ;;
    --no-claude)        CLAUDE_MAX=no; shift ;;
    --claude)           CLAUDE_MAX=yes; shift ;;
    --no-claude-login)  SKIP_CLAUDE_LOGIN=1; shift ;;
    -h|--help)          print_help; exit 0 ;;
    *)                  print_help; abort "unknown flag: $1" ;;
  esac
done

# ============================================================================
# 5 — preflight
# ============================================================================

banner
section "Preflight"

[[ "$EUID" -eq 0 ]] || abort "run as root (or via sudo)."

need=()
command -v curl    >/dev/null 2>&1 || need+=(curl)
command -v git     >/dev/null 2>&1 || need+=(git)
command -v openssl >/dev/null 2>&1 || need+=(openssl)
command -v jq      >/dev/null 2>&1 || need+=(jq)

if (( ${#need[@]} > 0 )); then
  if command -v apt-get >/dev/null 2>&1; then
    spin "installing host tools: ${need[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 \
      || spin_fail "apt update failed"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${need[@]}" >/dev/null 2>&1 \
      || spin_fail "apt install failed"
    spin_ok "installed: ${need[*]}"
  else
    abort "missing: ${need[*]} — install manually then re-run."
  fi
else
  ok "host tools present (curl · git · openssl · jq)"
fi

if ! command -v docker >/dev/null 2>&1; then
  spin "installing docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || spin_fail "docker install failed"
  spin_ok "docker installed"
fi
docker version >/dev/null 2>&1 || abort "docker daemon not running — try: systemctl start docker"
docker compose version >/dev/null 2>&1 || abort "docker compose plugin missing — apt install docker-compose-plugin"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) · compose $(docker compose version --short 2>/dev/null)"

mem_kb=$(awk '/^MemTotal/ {print $2}' /proc/meminfo)
disk_kb=$(df -k --output=avail / | tail -n1)
(( mem_kb  > 700000  )) || warn "<1 GB RAM detected ($((mem_kb/1024)) MB) — Mnela will run slowly."
(( disk_kb > 10000000 )) || warn "<10 GB free disk."
ok "$(( mem_kb / 1024 )) MB RAM · $(( disk_kb / 1024 / 1024 )) GB free on /"

# ============================================================================
# 6 — source resolution + clone
# ============================================================================

section "Source"

if [[ -z "$REPO_BRANCH" ]]; then
  spin "resolving latest release tag"
  REPO_BRANCH=$(git ls-remote --tags --sort='-v:refname' "$REPO_URL" 'v*' 2>/dev/null \
    | head -n1 | awk -F/ '{print $NF}' | sed 's/\^{}$//' || true)
  if [[ -z "$REPO_BRANCH" ]]; then
    spin_ok "no v* tags yet — using main"
    REPO_BRANCH=main
  else
    spin_ok "release: $REPO_BRANCH"
  fi
fi

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd || true)
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/../infra/docker/docker-compose.yml" ]]; then
  REPO_ROOT=$(cd "$SELF_DIR/.." && pwd)
  ok "using local checkout at $REPO_ROOT"
else
  if [[ -d "$INSTALL_PREFIX/.git" ]]; then
    if [[ "$FORCE" != "1" ]]; then
      if ! git -C "$INSTALL_PREFIX" diff-index --quiet HEAD --; then
        abort "$INSTALL_PREFIX has uncommitted edits. Stash them or re-run with --force."
      fi
    fi
    spin "updating $INSTALL_PREFIX to $REPO_BRANCH"
    git -C "$INSTALL_PREFIX" fetch --depth=1 origin "$REPO_BRANCH" >/dev/null 2>&1 \
      || spin_fail "git fetch failed"
    git -C "$INSTALL_PREFIX" checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH" >/dev/null 2>&1 \
      || spin_fail "git checkout failed"
    spin_ok "updated to $REPO_BRANCH"
  else
    # `git clone <url> <dir>` refuses if <dir> already exists and is non-
    # empty (typical aftermath of a half-finished previous attempt — mkdir
    # ran, clone died). Refuse to touch operator data: tell the user what
    # to remove and exit. NEVER auto-rm $INSTALL_PREFIX — it's overridable
    # via env, and a destructive default-on-flag is how installers eat
    # someone's $HOME.
    if [[ -d "$INSTALL_PREFIX" ]] && [[ -n "$(ls -A "$INSTALL_PREFIX" 2>/dev/null)" ]]; then
      abort "$INSTALL_PREFIX exists and is non-empty but isn't a git checkout. Inspect it, then remove if safe: rm -rf $INSTALL_PREFIX"
    fi
    spin "cloning $REPO_URL @ $REPO_BRANCH into $INSTALL_PREFIX"
    mkdir -p "$INSTALL_PREFIX"
    CLONE_LOG=$(mktemp -t mnela-clone.XXXXXX.log)
    if ! git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_PREFIX" >"$CLONE_LOG" 2>&1; then
      __spin_stop
      err "git clone failed (check $REPO_URL & branch $REPO_BRANCH) — output:"
      printf '%s\n' "---" >&2
      cat "$CLONE_LOG" >&2 2>/dev/null || true
      printf '%s\n' "---" >&2
      err "full log: $CLONE_LOG"
      exit 1
    fi
    rm -f "$CLONE_LOG"
    spin_ok "cloned"
  fi
  REPO_ROOT="$INSTALL_PREFIX"
fi
cd "$REPO_ROOT"

# ============================================================================
# 7 — questions
# ============================================================================

section "Configuration"

if [[ -f "$REPO_ROOT/.env" ]] && [[ "$FORCE" != "1" ]]; then
  warn "found existing $REPO_ROOT/.env — prior install detected"
  info "to start completely fresh you'd need to wipe volumes first:"
  info "    docker compose -f infra/docker/docker-compose.yml -p mnela down -v"
  info "    rm $REPO_ROOT/.env"
  info "    bash scripts/install.sh --force"
  printf '\n'
  ask_menu __EXISTING "What now?" \
    "keep|Keep prior config — just (re)bring services up with the same secrets" \
    "abort|Cancel and exit"
  [[ "$__EXISTING" == "keep" ]] || abort "cancelled"
fi

if [[ -f "$REPO_ROOT/.env" ]] && [[ "$FORCE" != "1" ]]; then
  # Preserve existing config — skip questions.
  set -a; . "$REPO_ROOT/.env"; set +a
  case "${MNELA_BIND_MODE:-}" in
    domain) CADDY_TEMPLATE="infra/caddy/Caddyfile.domain.template" ;;
    ip)     CADDY_TEMPLATE="infra/caddy/Caddyfile.ip.template" ;;
    tunnel) CADDY_TEMPLATE="infra/caddy/Caddyfile.tunnel.template" ;;
    *)      abort "couldn't determine MNELA_BIND_MODE from existing .env" ;;
  esac
  ok "loaded prior configuration"
  : "${CLAUDE_MAX:=no}"
else
  ask_menu MNELA_BIND_MODE \
    "How will users reach this Mnela?" \
    "domain|Public domain — Let's Encrypt TLS, needs a DNS A record" \
    "ip|Direct IP / hostname — self-signed TLS, no DNS needed" \
    "tunnel|Cloudflare Tunnel — no open ports, needs cloudflared sidecar"

  case "$MNELA_BIND_MODE" in
    domain)
      ask_text MNELA_DOMAIN "Public domain (DNS must already resolve to this host)" "" v_domain
      MNELA_PUBLIC_ORIGIN="https://$MNELA_DOMAIN"
      CADDY_TEMPLATE="infra/caddy/Caddyfile.domain.template"
      ;;
    ip)
      detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
      ask_text MNELA_HOST "Public IP or hostname" "$detected_ip" v_host
      MNELA_PUBLIC_ORIGIN="https://$MNELA_HOST"
      CADDY_TEMPLATE="infra/caddy/Caddyfile.ip.template"
      ;;
    tunnel)
      ask_text MNELA_DOMAIN "Public hostname Cloudflare routes to localhost:80" "" v_domain
      MNELA_PUBLIC_ORIGIN="https://$MNELA_DOMAIN"
      CADDY_TEMPLATE="infra/caddy/Caddyfile.tunnel.template"
      ;;
  esac

  if [[ -z "${CLAUDE_MAX:-}" ]]; then
    ask_menu CLAUDE_MAX \
      "Built-in AI: do you have a Claude Max subscription?" \
      "yes|Yes — sign in now (uses your Max quota, no API costs)" \
      "no|No — I'll add an Anthropic/OpenAI/Ollama key later via /admin/system"
  fi
fi

# ============================================================================
# 8 — review
# ============================================================================

section "Review"

case "$MNELA_BIND_MODE" in
  domain) HOST_LABEL="$MNELA_DOMAIN (Let's Encrypt TLS)" ;;
  ip)     HOST_LABEL="$MNELA_HOST (self-signed TLS)" ;;
  tunnel) HOST_LABEL="$MNELA_DOMAIN (Cloudflare Tunnel)" ;;
esac

kv "Install path"     "$REPO_ROOT"
kv "Release"          "$REPO_BRANCH"
kv "Bind mode"        "$MNELA_BIND_MODE"
kv "Host"             "$HOST_LABEL"
kv "Public URL"       "$MNELA_PUBLIC_ORIGIN"
kv "Claude Max"       "$CLAUDE_MAX$([[ "$CLAUDE_MAX" == "yes" ]] && (( ! SKIP_CLAUDE_LOGIN )) && echo " (OAuth in this terminal)" || true)"
kv ".env action"      "$([[ -f "$REPO_ROOT/.env" && "$FORCE" != "1" ]] && echo "keep existing" || echo "generate fresh (chmod 600)")"

if (( ! ASSUME_YES )); then
  ask_menu __CONFIRM "Proceed with these settings?" \
    "go|Yes, install now" \
    "abort|No, cancel"
  [[ "$__CONFIRM" == "go" ]] || abort "cancelled at review"
else
  ok "auto-confirmed (--yes)"
fi

# ============================================================================
# 9 — provisioning
# ============================================================================

section "Provisioning"

step "[1/6] writing .env"
ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]] || [[ "$FORCE" == "1" ]]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 32)
  REDIS_PASSWORD=$(openssl rand -hex 32)
  COOKIE_SECRET=$(openssl rand -hex 32)
  PROVIDER_SECRET=$(openssl rand -hex 32)
  INTERNAL_TOKEN="mn_$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)"

  cat >"$ENV_FILE" <<EOF
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ENV=production

MNELA_BIND_MODE=$MNELA_BIND_MODE
MNELA_DOMAIN=${MNELA_DOMAIN:-localhost}
MNELA_HOST=${MNELA_HOST:-localhost}
MNELA_PUBLIC_ORIGIN=$MNELA_PUBLIC_ORIGIN

POSTGRES_USER=mnela
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mnela
POSTGRES_PORT=5432
DATABASE_URL=postgresql://mnela:$POSTGRES_PASSWORD@localhost:5432/mnela?schema=public

REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_PORT=6379
REDIS_URL=redis://default:$REDIS_PASSWORD@localhost:6379

COOKIE_SECRET=$COOKIE_SECRET
SESSION_TTL_SECONDS=604800

MNELA_DATA_DIR=/data
MNELA_LOG_LEVEL=info

# AES-256-GCM master key for the keystore (provider API keys + Telegram
# token). DO NOT rotate without re-encrypting every encrypted row.
MNELA_PROVIDER_SECRET=$PROVIDER_SECRET

# Bearer token apps/tg-bot uses to call apps/api. Scope = mcp.
MNELA_INTERNAL_TOKEN=$INTERNAL_TOKEN

# 'local' = build from this checkout; flip to 'registry' once a GHCR
# release matches MNELA_VERSION (mnela update pulls instead of rebuilding).
MNELA_IMAGES=local
MNELA_VERSION=latest

CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
EOF
  chmod 600 "$ENV_FILE"
  ok "$ENV_FILE (chmod 600)"
else
  ok "$ENV_FILE kept (use --force to regenerate)"
fi
set -a; . "$ENV_FILE"; set +a

step "[2/6] materialising Caddyfile"
if [[ -f "$REPO_ROOT/Caddyfile" && "$FORCE" != "1" ]]; then
  ok "Caddyfile kept (operator edits preserved; --force to regenerate)"
else
  cp "$CADDY_TEMPLATE" "$REPO_ROOT/Caddyfile"
  ok "Caddyfile ← $CADDY_TEMPLATE"
fi

COMPOSE="docker compose -f infra/docker/docker-compose.yml -p mnela"
LOG_DIR="$REPO_ROOT/.install-logs"
mkdir -p "$LOG_DIR"

# BuildKit's TTY progress bar trashes a log file with control codes —
# plain mode is line-based and readable when tailed on failure.
export BUILDKIT_PROGRESS=plain

step "[3/6] images ($MNELA_IMAGES mode, may take 10–30 min)"
if [[ "$MNELA_IMAGES" == "registry" ]]; then
  run_quiet "$LOG_DIR/images-pull.log" "pulling images" \
    $COMPOSE --profile prod --profile migrate pull
else
  run_quiet "$LOG_DIR/images-build.log" "building images" \
    $COMPOSE --profile prod --profile migrate build
fi

step "[4/6] applying database migrations"
run_quiet "$LOG_DIR/migrate.log" "prisma migrate deploy" \
  $COMPOSE --profile migrate run --rm migrate

step "[5/6] starting prod services"
run_quiet "$LOG_DIR/up.log" "starting containers" \
  $COMPOSE --profile prod up -d

step "[6/6] provisioning bootstrap AuthToken for tg-bot"
spin "waiting for api healthcheck"
api_ready=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if $COMPOSE exec -T api node healthcheck.js </dev/null >/dev/null 2>&1; then
    api_ready=1; break
  fi
  sleep 2
done
__spin_stop
if (( ! api_ready )); then
  warn "api didn't pass healthcheck within 30s — token provisioning may fail"
fi
$COMPOSE exec -T -e MNELA_INTERNAL_TOKEN="$MNELA_INTERNAL_TOKEN" api \
  node scripts/issue-bootstrap-token.mjs </dev/null \
  || abort "could not issue install-time AuthToken — tg-bot will fail auth. See api logs."
ok "AuthToken issued (sha256 stored in DB, plaintext stays in .env)"

# ============================================================================
# 10 — Claude Max OAuth (inline)
# ============================================================================

if [[ "${CLAUDE_MAX:-no}" == "yes" ]] && (( ! SKIP_CLAUDE_LOGIN )); then
  section "Claude Max — sign in"

  spin "waiting for orchestrator's claude CLI"
  cli_ready=0
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if $COMPOSE exec -T orchestrator claude --version </dev/null >/dev/null 2>&1; then
      cli_ready=1; break
    fi
    sleep 2
  done
  __spin_stop

  if (( ! cli_ready )); then
    warn "orchestrator's claude CLI didn't respond within 30s"
    info "finish the OAuth later with:"
    info "    docker exec -it mnela-orchestrator claude login"
  elif [[ "$HAVE_TTY" != "1" ]]; then
    warn "no TTY available for the OAuth dance"
    info "finish later with:"
    info "    docker exec -it mnela-orchestrator claude login"
  else
    ok "claude CLI v$($COMPOSE exec -T orchestrator claude --version </dev/null 2>/dev/null | head -n1 | awk '{print $NF}')"
    printf '\n'
    info "Claude will print a one-time URL. Open it in your browser, complete the"
    info "OAuth flow, then paste the code Anthropic shows back into this terminal."
    info "The token lands in the mnela-claude-creds volume and survives container"
    info "restarts. Backups via scripts/backup.sh round-trip it too."
    printf '\n'

    if $COMPOSE exec orchestrator claude login </dev/tty; then
      ok "Claude Max signed in"
    else
      warn "claude login exited non-zero — token may not be saved"
      info "retry with: docker exec -it mnela-orchestrator claude login"
    fi
  fi
fi

# ============================================================================
# 11 — done
# ============================================================================

section "Done"

printf '\n    %s✓%s  Mnela is up at %s%s%s\n\n' \
  "$CG" "$C0" "$CB" "$MNELA_PUBLIC_ORIGIN" "$C0"

printf '  %sNext steps%s\n' "$CB" "$C0"
printf '    1. Open %s%s/setup%s to create the first admin (12-char password).\n' \
  "$CC" "$MNELA_PUBLIC_ORIGIN" "$C0"

if [[ "${CLAUDE_MAX:-no}" == "yes" ]]; then
  printf '    2. The wizard'\''s Modules step should show Claude Max as signed in.\n'
else
  printf '    2. In the wizard, expand %sAI Providers%s and paste your API key\n' "$CB" "$C0"
  printf '       (Anthropic / OpenAI / DeepSeek / Grok / Gemini / OpenRouter / Ollama).\n'
fi

printf '    3. Schedule daily backups (recommended):\n'
printf '       %s(crontab -l 2>/dev/null; echo "0 4 * * * cd %s && bash scripts/backup.sh >> /var/log/mnela-backup.log 2>&1") | crontab -%s\n\n' \
  "$CK" "$REPO_ROOT" "$C0"

printf '  %sOperator cheatsheet%s\n' "$CB" "$C0"
printf '    %smnela status%s            container status\n' "$CK" "$C0"
printf '    %smnela logs api -f%s       tail one service\n' "$CK" "$C0"
printf '    %smnela logs%s              tail everything\n' "$CK" "$C0"
printf '    %smnela backup%s            one-off backup\n' "$CK" "$C0"
printf '    %smnela claude:test%s       verify Claude Max wiring\n' "$CK" "$C0"
printf '    %smnela update%s            pull latest release\n\n' "$CK" "$C0"
