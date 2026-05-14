#!/usr/bin/env bash
#
# scripts/backup.sh — bundle a Mnela install into a single .tar.gz that can
# be restored on another VPS without losing the encrypted provider/Telegram
# secrets.
#
# Contents of the bundle:
#   ./manifest.json                  — version, timestamp, paths used at backup time
#   ./postgres.sql.gz                — pg_dump from inside mnela-postgres
#   ./data.tar                       — $MNELA_DATA_DIR (incl. keystore/provider.key!)
#   ./claude-creds.tar (optional)    — /home/mnela/.claude from mnela-orchestrator
#
# The whole point of this script is that the `keystore/provider.key` file
# ends up in the bundle. Without it every `LlmProvider.apiKeyEnc` and
# `TelegramBot.tokenEnc` row in the SQL dump is undecryptable on the
# destination host — losing the key effectively wipes those secrets.
#
# Usage:
#   ./scripts/backup.sh                         # default output dir
#   ./scripts/backup.sh -o /tmp                 # specific output dir
#   MNELA_BACKUP_DIR=/var/backups ./scripts/backup.sh
#
# Env knobs:
#   MNELA_BACKUP_DIR     where the .tar.gz lands (default: ./backups)
#   COMPOSE_FILE         alternate compose path (default: infra/docker/docker-compose.yml)
#   COMPOSE_PROJECT_NAME compose project (default: mnela)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

# ----- defaults -----------------------------------------------------------
BACKUP_DIR=${MNELA_BACKUP_DIR:-"$REPO_ROOT/backups"}
COMPOSE_FILE=${COMPOSE_FILE:-"infra/docker/docker-compose.yml"}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-mnela}
ALLOW_NO_KEYSTORE=0
TS=$(date -u +%Y-%m-%d-%H%M%S)

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) BACKUP_DIR="$2"; shift 2 ;;
    --allow-no-keystore) ALLOW_NO_KEYSTORE=1; shift ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0 ;;
    *)
      echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ----- preflight ----------------------------------------------------------
require() {
  command -v "$1" >/dev/null 2>&1 || { echo "✘ missing prerequisite: $1" >&2; exit 1; }
}
require docker
require tar
require gzip

if ! docker compose version >/dev/null 2>&1; then
  echo "✘ docker compose plugin not installed" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "✘ compose file not found at $COMPOSE_FILE — set COMPOSE_FILE to override" >&2
  exit 1
fi

# Load .env so POSTGRES_USER / POSTGRES_DB are visible.
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi
POSTGRES_USER=${POSTGRES_USER:-mnela}
POSTGRES_DB=${POSTGRES_DB:-mnela}

mkdir -p "$BACKUP_DIR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

OUT="$BACKUP_DIR/mnela-$TS.tar.gz"

echo "▸ Mnela backup → $OUT"
echo "  postgres user/db: $POSTGRES_USER / $POSTGRES_DB"

# ----- 1. pg_dump from inside the postgres container ---------------------
echo "  [1/4] pg_dump"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  pg_dump --no-owner --no-privileges --clean --if-exists \
          -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip -9 > "$WORK/postgres.sql.gz"

# ----- 2. /data volume (incl. keystore) ----------------------------------
# Run a throwaway alpine container that mounts the mnela-data volume and
# tars the contents to stdout. Keeps the host script Docker-agnostic.
echo "  [2/4] /data volume (keystore + uploads + vault + dropbox)"
docker run --rm \
  -v mnela-data:/data:ro \
  alpine:3 \
  tar -C /data -cf - . > "$WORK/data.tar"

DATA_BYTES=$(wc -c < "$WORK/data.tar")
echo "        $(numfmt --to=iec --suffix=B "$DATA_BYTES" 2>/dev/null || echo "${DATA_BYTES}B")"

if ! tar -tf "$WORK/data.tar" 2>/dev/null | grep -q '^\./keystore/provider.key$\|^keystore/provider.key$'; then
  if [[ "$ALLOW_NO_KEYSTORE" == "1" ]]; then
    echo "  ⚠ keystore/provider.key not present in /data — continuing because --allow-no-keystore."
    echo "    Make sure your destination uses the SAME MNELA_PROVIDER_SECRET env value," >&2
    echo "    or the encrypted LlmProvider / TelegramBot rows won't decrypt." >&2
  else
    echo "✘ keystore/provider.key not present in /data." >&2
    echo "  This means MNELA_PROVIDER_SECRET is set via env, not file-backed." >&2
    echo "  Without the key the encrypted LlmProvider.apiKeyEnc and" >&2
    echo "  TelegramBot.tokenEnc rows in the dump cannot be decrypted on" >&2
    echo "  the destination host. To proceed anyway (and own the responsibility" >&2
    echo "  of replicating MNELA_PROVIDER_SECRET out-of-band) re-run with" >&2
    echo "  --allow-no-keystore." >&2
    exit 1
  fi
fi

# ----- 3. /home/mnela/.claude (best-effort) ------------------------------
echo "  [3/4] claude credentials (if present)"
if docker volume inspect mnela-claude-creds >/dev/null 2>&1; then
  docker run --rm \
    -v mnela-claude-creds:/cc:ro \
    alpine:3 \
    tar -C /cc -cf - . > "$WORK/claude-creds.tar" || rm -f "$WORK/claude-creds.tar"
fi

# ----- 4. manifest + final tarball ---------------------------------------
echo "  [4/4] manifest + archive"
HAS_CC=$([[ -s "$WORK/claude-creds.tar" ]] && echo true || echo false)
cat >"$WORK/manifest.json" <<EOF
{
  "mnela_backup_version": 1,
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgres_user": "$POSTGRES_USER",
  "postgres_db": "$POSTGRES_DB",
  "compose_project_name": "$COMPOSE_PROJECT_NAME",
  "source": "cli",
  "includes": {
    "postgres": true,
    "data_volume": true,
    "claude_creds": $HAS_CC
  }
}
EOF

tar -C "$WORK" -czf "$OUT" .

# Also publish a copy into the mnela-backups named volume so the
# /admin/system → Backups UI lists CLI-produced bundles alongside
# UI-produced ones. Silent skip if the volume doesn't exist (dev mode
# without `--profile prod up -d`).
if docker volume inspect mnela-backups >/dev/null 2>&1; then
  OUT_NAME=$(basename "$OUT")
  docker run --rm \
    -v mnela-backups:/out \
    -v "$OUT:/in/bundle.tar.gz:ro" \
    alpine:3 \
    cp "/in/bundle.tar.gz" "/out/$OUT_NAME" || true
fi

SIZE=$(wc -c < "$OUT")
SIZE_H=$(numfmt --to=iec --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE}B")
echo "✓ $OUT ($SIZE_H)"
echo
echo "Copy off-host to survive a VPS loss:"
echo "  scp \"$OUT\" you@another-host:/var/backups/"
