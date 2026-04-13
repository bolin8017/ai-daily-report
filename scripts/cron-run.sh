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

ts() { date -Iseconds; }

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

docker run --rm \
  --name ai-daily-report \
  --memory="$MEMORY_LIMIT" \
  --memory-swap="$MEMORY_SWAP" \
  --cpus=2 \
  --add-host metadata.google.internal:127.0.0.1 \
  --add-host metadata:127.0.0.1 \
  -e GITHUB_TOKEN \
  -e REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}" \
  -e CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-6}" \
  -v "$VOLUME":/workspace \
  -v "$CLAUDE_HOST_DIR":/home/pipeline/.claude:ro \
  -v "${HOME}/.claude.json":/home/pipeline/.claude.json:ro \
  "$IMAGE"

echo "[cron-run] $(ts) === run complete ==="
