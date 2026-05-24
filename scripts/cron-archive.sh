#!/usr/bin/env bash
# Host-side wrapper invoked by the monthly archive systemd timer.
# Mirrors scripts/cron-run.sh in shape: loads secrets, runs the
# ai-daily-report Docker image in `archive` mode.
#
# Idempotent. Designed to be safe even if invoked manually outside
# the timer (e.g. after a missed schedule firing).

set -euo pipefail

SECRETS_FILE="${HOME}/.ai-daily-report.env"
IMAGE="ai-daily-report:latest"
VOLUME="ai-daily-report-workspace"
MEMORY_LIMIT="${PIPELINE_MEMORY_LIMIT:-400m}"
MEMORY_SWAP="${PIPELINE_MEMORY_SWAP:-800m}"

ts() { date -Iseconds; }

echo
echo "[cron-archive] $(ts) === starting archive job ==="

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[cron-archive] FATAL: ${SECRETS_FILE} not found; create it with GITHUB_TOKEN=..."
  exit 1
fi
# shellcheck source=/dev/null
set -a; source "$SECRETS_FILE"; set +a

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[cron-archive] FATAL: GITHUB_TOKEN not set in ${SECRETS_FILE}"
  exit 1
fi

# Verify the image exists. If not, log and exit — the daily job will
# build it on its next run (we don't rebuild here to keep this cron
# fast and minimize surface area).
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[cron-archive] WARN: image ${IMAGE} missing — skipping (daily job will rebuild)" >&2
  exit 0
fi

# Create the workspace volume if missing (idempotent)
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null

docker run --rm \
  --name ai-daily-report-archive \
  --memory="$MEMORY_LIMIT" \
  --memory-swap="$MEMORY_SWAP" \
  --cpus=1 \
  --security-opt=no-new-privileges \
  -e GITHUB_TOKEN \
  -e REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}" \
  -e HOT_DAYS="${HOT_DAYS:-60}" \
  -e ACTIVE_THEME="${ACTIVE_THEME:-ai-builder}" \
  -v "$VOLUME":/workspace \
  "$IMAGE" \
  archive

echo "[cron-archive] $(ts) === archive complete ==="
