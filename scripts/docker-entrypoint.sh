#!/usr/bin/env bash
# Container entrypoint. Runs inside the ai-daily-report Docker image.
#
# Modes:
#   No args / "both" : full pipeline — Stage 1 (collect) then Stage 2 (analyze)
#   "collect"        : Stage 1 only — fetch + condense + commit staging data
#   "analyze"        : Stage 2 only — claude agent produces report + memory
#   Other args       : exec directly (for `docker run ... bash` or `docker run ... claude /login`)
#
# Expected environment:
#   GITHUB_TOKEN       — PAT with Contents:read/write scope for clone + push
#   REPORT_TIMEZONE    — optional, defaults to Asia/Taipei
#   CLAUDE_MODEL       — optional, defaults to claude-opus-4-6
#   /root/.claude      — bind-mounted claude CLI auth state (host's ~/.claude)
#   /workspace         — Docker named volume (persistent across runs)

set -euo pipefail

# Pass-through mode: if args are not one of our commands, exec them directly.
MODE="${1:-both}"
case "$MODE" in
  collect|analyze|both) ;;
  *) exec "$@" ;;
esac

# ── Workspace setup ────────────────────────────────────────────

REPO_URL="https://github.com/bolin8017/ai-daily-report.git"
WORKSPACE="/workspace"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: GITHUB_TOKEN is required" >&2
  exit 1
fi

AUTH_URL="${REPO_URL/https:\/\//https:\/\/x-access-token:${GITHUB_TOKEN}@}"

cd "$WORKSPACE"
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

# Install deps only if package-lock.json is newer than last install.
# npm ci creates node_modules/.package-lock.json with the current timestamp,
# so a subsequent git pull that updates package-lock.json triggers reinstall.
LOCK_MARK="node_modules/.package-lock.json"
if [ ! -f "$LOCK_MARK" ] || [ "package-lock.json" -nt "$LOCK_MARK" ]; then
  echo "[entrypoint] installing npm dependencies..."
  npm ci --omit=dev --no-audit --no-fund --prefer-offline
fi

# ── Run stages ─────────────────────────────────────────────────

case "$MODE" in
  collect)
    echo "[entrypoint] running Stage 1 (collect only)"
    exec node src/collect.js
    ;;
  analyze)
    echo "[entrypoint] running Stage 2 (analyze only)"
    exec bash scripts/analyze.sh
    ;;
  both)
    echo "[entrypoint] running Stage 1 + Stage 2"
    node src/collect.js
    exec bash scripts/analyze.sh
    ;;
esac
