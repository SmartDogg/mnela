#!/usr/bin/env bash
#
# scripts/restore.sh — restore a Mnela bundle produced by scripts/backup.sh.
#
# Critical safety: the bundle's provider.key MUST decrypt at least one
# LlmProvider.apiKeyEnc row from the SQL dump (or the dump must have zero
# rows). Otherwise the restore would silently render every saved API key
# and the Telegram bot token unusable, and the user would only notice
# weeks later when an LLM call fails.
#
# Stop set: api / worker / orchestrator / tg-bot / mcp / web / caddy
# Keep running: postgres + redis (we restore INTO them, not over them)
#
# Usage:
#   ./scripts/restore.sh path/to/mnela-2026-05-14-120000.tar.gz
#   ./scripts/restore.sh --skip-keystore-check path/to/foo.tar.gz   # advanced
#
# Env:
#   COMPOSE_FILE         alternate compose path
#   COMPOSE_PROJECT_NAME compose project (default: mnela)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

COMPOSE_FILE=${COMPOSE_FILE:-"infra/docker/docker-compose.yml"}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-mnela}
SKIP_KEYSTORE_CHECK=0
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-keystore-check) SKIP_KEYSTORE_CHECK=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *)
      if [[ -z "$BACKUP_FILE" ]]; then BACKUP_FILE="$1"; shift
      else echo "Unexpected argument: $1" >&2; exit 2; fi
      ;;
  esac
done

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup.tar.gz>" >&2
  exit 2
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "✘ backup not found: $BACKUP_FILE" >&2
  exit 1
fi

require() { command -v "$1" >/dev/null 2>&1 || { echo "✘ missing prerequisite: $1" >&2; exit 1; }; }
require docker
require tar
require gunzip
require node
docker compose version >/dev/null 2>&1 || { echo "✘ docker compose plugin missing" >&2; exit 1; }

# Load .env so POSTGRES_USER / POSTGRES_DB are visible.
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi
POSTGRES_USER=${POSTGRES_USER:-mnela}
POSTGRES_DB=${POSTGRES_DB:-mnela}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "▸ Mnela restore ← $BACKUP_FILE"

# ----- 1. unpack ---------------------------------------------------------
echo "  [1/7] unpacking"
tar -C "$WORK" -xzf "$BACKUP_FILE"
[[ -f "$WORK/manifest.json" ]] || { echo "✘ bundle missing manifest.json" >&2; exit 1; }
[[ -f "$WORK/postgres.sql.gz" ]] || { echo "✘ bundle missing postgres.sql.gz" >&2; exit 1; }
[[ -f "$WORK/data.tar" ]] || { echo "✘ bundle missing data.tar" >&2; exit 1; }

# ----- 2. ensure postgres + redis are up ---------------------------------
echo "  [2/7] bringing postgres + redis online (they stay up through the restore)"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" up -d postgres redis
# Wait for healthy postgres. Fail fast with a clear message instead of
# pressing on; the next step's psql restore would otherwise crash with
# an unhelpful "connection refused".
PG_READY=0
for i in {1..30}; do
  if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
       pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    PG_READY=1
    break
  fi
  sleep 1
done
if [[ "$PG_READY" != "1" ]]; then
  echo "✘ postgres did not become healthy within 30s — check 'docker compose logs postgres'" >&2
  exit 1
fi

# ----- 3. validate keystore decrypts at least one provider row -----------
echo "  [3/7] validating keystore against SQL dump"
mkdir -p "$WORK/data-extract"
tar -C "$WORK/data-extract" -xf "$WORK/data.tar"
PROVIDER_KEY="$WORK/data-extract/keystore/provider.key"

if [[ ! -f "$PROVIDER_KEY" ]]; then
  if [[ "$SKIP_KEYSTORE_CHECK" == "1" ]]; then
    echo "       no provider.key in bundle, --skip-keystore-check set — continuing"
  else
    echo "  ⚠ no provider.key in bundle. If you backed up with MNELA_PROVIDER_SECRET" >&2
    echo "    set via env, make sure THAT same env value is exported on the target" >&2
    echo "    host before restoring. Re-run with --skip-keystore-check to acknowledge." >&2
    exit 1
  fi
else
  # validate-keystore.mjs decrypts the first non-NULL LlmProvider.apiKeyEnc
  # row using Node's crypto.createDecipheriv — works on every Node 22 host,
  # unlike the previous openssl -aead_tag_hex hack which only LibreSSL
  # builds support.
  if node "$REPO_ROOT/scripts/validate-keystore.mjs" "$PROVIDER_KEY" "$WORK/postgres.sql.gz"; then
    :
  elif [[ "$SKIP_KEYSTORE_CHECK" == "1" ]]; then
    echo "       ⚠ keystore did NOT decrypt — continuing because --skip-keystore-check"
  else
    echo "       ✘ keystore validation failed. Refusing to wipe the target DB." >&2
    echo "         Re-run with --skip-keystore-check if you accept that every" >&2
    echo "         encrypted LlmProvider.apiKeyEnc + TelegramBot.tokenEnc will" >&2
    echo "         become unreadable after restore." >&2
    exit 1
  fi
fi

# ----- 4. stop everything except postgres + redis ------------------------
echo "  [4/7] stopping app containers (postgres/redis stay)"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" \
  --profile prod stop api web worker orchestrator tg-bot mcp caddy 2>/dev/null || true

# ----- 5. restore postgres ----------------------------------------------
echo "  [5/7] restoring postgres dump"
gunzip -c "$WORK/postgres.sql.gz" \
  | docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  > /dev/null

# ----- 6. restore /data + claude creds -----------------------------------
echo "  [6/7] restoring /data volume"
# `find -mindepth 1 -delete` covers hidden + dot-prefixed entries that the
# bash glob `.[!.]*` misses; busybox-find on alpine supports the same flags.
docker run --rm \
  -v mnela-data:/data \
  -v "$WORK:/in:ro" \
  alpine:3 \
  sh -c 'find /data -mindepth 1 -delete; tar -C /data -xf /in/data.tar'

if [[ -f "$WORK/claude-creds.tar" ]]; then
  echo "       restoring claude credentials"
  docker run --rm \
    -v mnela-claude-creds:/cc \
    -v "$WORK:/in:ro" \
    alpine:3 \
    sh -c 'find /cc -mindepth 1 -delete; tar -C /cc -xf /in/claude-creds.tar'
fi

# ----- 7. migrate + reindex FTS + restart apps ---------------------------
echo "  [7/7] running migrations + FTS reindex + restarting apps"
# Use the one-shot migrate service (--profile migrate) so we don't depend
# on the api container being healthy first.
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" \
  --profile migrate run --rm migrate \
  || { echo "✘ prisma migrate deploy failed — backup schema is newer than image" >&2; exit 1; }

docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'REINDEX SCHEMA public;' >/dev/null

docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" \
  --profile prod up -d

echo
echo "✓ restore complete"
echo "  next: tail logs with  docker compose -f $COMPOSE_FILE -p $COMPOSE_PROJECT_NAME logs -f api"
echo "  if you backed up before changing MNELA_PROVIDER_SECRET, make sure THIS host's .env"
echo "  has the same value, otherwise LLM providers won't decrypt their API keys."
