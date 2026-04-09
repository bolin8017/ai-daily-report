#!/usr/bin/env bash
# Container entrypoint. Runs inside the ai-daily-report Docker image.
#
# Two modes:
#   1. No args (cron default): clone/pull repo, npm ci, exec the pipeline.
#      Requires GITHUB_TOKEN.
#   2. Args passed (interactive / debug): exec the args directly, bypassing
#      the pipeline. Used for `docker run ai-daily-report claude` (one-time
#      OAuth) or `docker run ai-daily-report bash` (ad-hoc shell).
#
# Expected environment (mode 1 only):
#   GITHUB_TOKEN       — PAT with Contents:read/write scope for clone + push
#   REPORT_TIMEZONE    — optional, defaults to Asia/Taipei
#   /root/.claude      — bind-mounted claude CLI auth state (host's ~/.claude)
#   /workspace         — Docker named volume (persistent across runs)

set -euo pipefail

# Mode 2: if any args were passed to `docker run`, exec them directly.
# Nothing below this point runs when an explicit command is given, which is
# what you want for interactive sessions (no GITHUB_TOKEN check, no git pull).
if [ $# -gt 0 ]; then
  exec "$@"
fi

REPO_URL="https://github.com/bolin8017/ai-daily-report.git"
WORKSPACE="/workspace"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: GITHUB_TOKEN is required" >&2
  exit 1
fi

# Tokenized URL for clone/fetch/push. Kept out of git history by only using
# it in-memory here.
AUTH_URL="${REPO_URL/https:\/\//https:\/\/x-access-token:${GITHUB_TOKEN}@}"

cd "$WORKSPACE"

# Git insists safe.directory is configured when mounted paths have a different
# owner than the running user. Accept the volume as safe.
git config --global --add safe.directory "$WORKSPACE"

if [ ! -d .git ]; then
  echo "[entrypoint] cloning ${REPO_URL} into ${WORKSPACE}..."
  git clone "$AUTH_URL" .
else
  echo "[entrypoint] pulling latest main..."
  git remote set-url origin "$AUTH_URL"
  git fetch origin main --quiet
  git reset --hard origin/main
fi

# Install deps only if package-lock.json has moved since last install
LOCK_MARK="node_modules/.package-lock.json"
if [ ! -f "$LOCK_MARK" ] || [ "package-lock.json" -nt "$LOCK_MARK" ]; then
  echo "[entrypoint] installing npm dependencies..."
  npm ci --omit=dev --no-audit --no-fund --prefer-offline
  cp package-lock.json "$LOCK_MARK"
fi

echo "[entrypoint] starting pipeline"
exec node src/pipeline.js
