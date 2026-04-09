#!/usr/bin/env bash
# Host-side cron wrapper. Invoked by a crontab entry like:
#
#   TZ=Asia/Taipei
#   0 4 * * * /home/bolin8017/ai-daily-report/scripts/cron-run.sh >> /var/log/ai-daily-report.log 2>&1
#
# Responsibilities:
#   1. Load environment (GITHUB_TOKEN) from a secrets file
#   2. Run the Docker image with memory caps, persistent workspace volume, and
#      the host's ~/.claude bind-mounted for Claude CLI auth state
#   3. Log a dated banner before/after so log tails are readable
#
# The pipeline itself runs inside the container; this wrapper only handles
# invocation, resource limits, and logging.

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
  -e GITHUB_TOKEN \
  -e REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}" \
  -v "$VOLUME":/workspace \
  -v "$CLAUDE_HOST_DIR":/root/.claude \
  "$IMAGE"

echo "[cron-run] $(ts) === run complete ==="
