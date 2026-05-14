#!/usr/bin/env bash
#
# scripts/update.sh — pull the latest Mnela release and apply it.
#
# Sequence:
#   1. git fetch + checkout the requested tag (default: latest v* tag)
#   2. pull or rebuild images for MNELA_IMAGES mode
#   3. run prisma migrate deploy (one-shot migrate service)
#   4. `docker compose --profile prod up -d` rolls every service
#
# Idempotent: re-running with the same target tag is a no-op except for
# the `up -d` recreate (which only restarts containers whose config or
# image changed).
#
# Usage:
#   ./scripts/update.sh                   # update to the latest v* tag
#   ./scripts/update.sh --tag v0.3.1      # pin to a specific tag
#   ./scripts/update.sh --branch main     # development branch tracking

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }
abort()  { red "✘ $*"; exit 1; }

TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag|--branch) TARGET="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *) abort "Unknown flag: $1 (use --help)" ;;
  esac
done

# ----- load .env so we know MNELA_IMAGES mode ----------------------------
[[ -f "$REPO_ROOT/.env" ]] || abort "no .env at $REPO_ROOT — run scripts/install.sh first."
set -a; . "$REPO_ROOT/.env"; set +a

MNELA_IMAGES=${MNELA_IMAGES:-local}
COMPOSE="docker compose -f infra/docker/docker-compose.yml -p mnela"

# ----- resolve target tag ------------------------------------------------
if [[ -z "$TARGET" ]]; then
  TARGET=$(git ls-remote --tags --sort='-v:refname' origin 'v*' \
    | head -n1 | awk -F/ '{print $NF}' | sed 's/\^{}$//' || true)
  if [[ -z "$TARGET" ]]; then
    yellow "  no v* tags published; falling back to current branch HEAD"
    TARGET=$(git rev-parse --abbrev-ref HEAD)
  fi
fi
cyan "▸ Updating to $TARGET"

# ----- guard against uncommitted local edits -----------------------------
if ! git diff-index --quiet HEAD --; then
  abort "working tree has local edits; commit / stash before updating."
fi

# ----- fetch + checkout --------------------------------------------------
git fetch --tags --depth=1 origin "$TARGET" 2>/dev/null || git fetch --depth=1 origin "$TARGET"
git checkout "$TARGET"
green "  on $TARGET"

# ----- pull or rebuild images --------------------------------------------
if [[ "$MNELA_IMAGES" == "registry" ]]; then
  cyan "▸ Pulling images for tag $TARGET"
  MNELA_VERSION="$TARGET" $COMPOSE --profile prod --profile migrate pull
else
  cyan "▸ Rebuilding images (local mode)"
  $COMPOSE --profile prod --profile migrate build
fi

# ----- apply migrations --------------------------------------------------
cyan "▸ Applying database migrations"
$COMPOSE --profile migrate run --rm migrate \
  || abort "prisma migrate deploy failed — investigate logs above."

# ----- restart stack with new images -------------------------------------
cyan "▸ Restarting prod stack"
$COMPOSE --profile prod up -d

green "✓ Mnela updated to $TARGET"
echo
echo "  logs:    $COMPOSE logs -f"
echo "  status:  $COMPOSE ps"
