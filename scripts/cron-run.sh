#!/usr/bin/env bash
# Host-side cron wrapper. Invoked by a crontab entry like:
#
#   TZ=Asia/Taipei
#   0 4 * * * /home/bolin8017/ai-daily-report/scripts/cron-run.sh >> /var/log/ai-daily-report.log 2>&1
#
# Two-stage pipeline:
#   Stage 1 (collect): fetch + condense + snapshot → commit staging data
#   Stage 2 (analyze): claude agent reads staging data → writes report + memory → commit
#
# Both stages run inside the same Docker container invocation.

set -euo pipefail

SECRETS_FILE="${HOME}/.ai-daily-report.env"
IMAGE="ai-daily-report:latest"
VOLUME="ai-daily-report-workspace"
CLAUDE_HOST_DIR="${HOME}/.claude"
MEMORY_LIMIT="${PIPELINE_MEMORY_LIMIT:-600m}"
MEMORY_SWAP="${PIPELINE_MEMORY_SWAP:-1g}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ts() { date -Iseconds; }

# Rebuild the image if Dockerfile / package.json / package-lock.json have
# changed since the image was last built. Avoids the "forgot to rebuild
# after Dockerfile update" footgun now that Dependabot can land base-image
# digest bumps automatically. Falls back to the existing image if build
# fails — we'd rather run a stale image than skip the daily report.
image_needs_rebuild() {
  docker image inspect "$IMAGE" >/dev/null 2>&1 || return 0
  local img_created_epoch
  img_created_epoch=$(date -d "$(docker image inspect --format='{{.Created}}' "$IMAGE")" +%s 2>/dev/null || echo 0)
  local f mtime
  for f in Dockerfile package.json package-lock.json; do
    [ -f "$REPO_DIR/$f" ] || continue
    mtime=$(stat -c %Y "$REPO_DIR/$f")
    if [ "$mtime" -gt "$img_created_epoch" ]; then
      echo "[cron-run] $(ts) $f mtime newer than image — rebuild required"
      return 0
    fi
  done
  return 1
}

maybe_rebuild_image() {
  if image_needs_rebuild; then
    echo "[cron-run] $(ts) rebuilding $IMAGE from $REPO_DIR..."
    if docker build -t "$IMAGE" "$REPO_DIR"; then
      echo "[cron-run] $(ts) rebuild successful"
    elif docker image inspect "$IMAGE" >/dev/null 2>&1; then
      echo "[cron-run] $(ts) WARN: rebuild failed — falling back to existing image" >&2
    else
      echo "[cron-run] $(ts) FATAL: image build failed and no fallback available" >&2
      exit 1
    fi
  fi
}

echo
echo "[cron-run] $(ts) === starting run ==="

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[cron-run] FATAL: ${SECRETS_FILE} not found; create it with GITHUB_TOKEN=..."
  exit 1
fi
# shellcheck source=/dev/null
set -a; source "$SECRETS_FILE"; set +a

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[cron-run] FATAL: GITHUB_TOKEN not set in ${SECRETS_FILE}"
  exit 1
fi

if [ ! -d "$CLAUDE_HOST_DIR" ]; then
  echo "[cron-run] FATAL: ${CLAUDE_HOST_DIR} missing — run \`claude\` once interactively on the host to create it"
  exit 1
fi

# Create the workspace volume if it doesn't exist (idempotent)
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null

# Rebuild image if Dockerfile or npm deps have changed since last build
maybe_rebuild_image

docker run --rm \
  --name ai-daily-report \
  --memory="$MEMORY_LIMIT" \
  --memory-swap="$MEMORY_SWAP" \
  --cpus=2 \
  --security-opt=no-new-privileges \
  --add-host metadata.google.internal:127.0.0.1 \
  --add-host metadata:127.0.0.1 \
  -e GITHUB_TOKEN \
  -e REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}" \
  -e CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-6}" \
  -v "$VOLUME":/workspace \
  -v "$CLAUDE_HOST_DIR":/home/pipeline/.claude \
  -v "${HOME}/.claude.json":/home/pipeline/.claude.json \
  "$IMAGE"

echo "[cron-run] $(ts) === run complete ==="
