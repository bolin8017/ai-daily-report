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
#   ~/.claude           — bind-mounted claude CLI auth state (host's ~/.claude, read-only)
#   /workspace         — Docker named volume (persistent across runs)

set -euo pipefail

# If running as root, fix workspace ownership (migration from older root-based
# containers) and re-exec as the non-root pipeline user via gosu.
if [ "$(id -u)" = "0" ] && id pipeline >/dev/null 2>&1; then
  chown -R pipeline:pipeline /workspace 2>/dev/null || true
  chown -R pipeline:pipeline /home/pipeline 2>/dev/null || true
  exec gosu pipeline "$0" "$@"
fi

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

# Inject auth via GIT_CONFIG_COUNT (Git 2.31+) so the token is never
# written to .git/config or the remote URL. A container crash between
# git operations can no longer leave the token persisted in the volume.
# This is the same mechanism GitHub's own actions/checkout uses.
GITHUB_AUTH_HEADER=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0='http.https://github.com/.extraheader'
export GIT_CONFIG_VALUE_0="Authorization: Basic ${GITHUB_AUTH_HEADER}"
export GIT_TERMINAL_PROMPT=0

cd "$WORKSPACE"
git config --global --add safe.directory "$WORKSPACE"

if [ ! -d .git ]; then
  echo "[entrypoint] cloning ${REPO_URL} into ${WORKSPACE}..."
  git clone "$REPO_URL" .
else
  echo "[entrypoint] pulling latest main..."
  # If this volume was created by an earlier image that embedded the
  # token in the remote URL, overwrite it with the plain URL. Harmless
  # no-op on fresh volumes.
  git remote set-url origin "$REPO_URL"
  git fetch origin main --quiet
  git reset --hard origin/main
fi

# Hydrate data/ from the `data` orphan branch. It holds the archived
# reports, memory.json, feeds-snapshot.json, and staging files. Main
# only tracks code, so without this step Stage 2 has no memory and
# the 11ty templates have no past reports.
#
# Distinguish three cases so a real failure (network, auth, disk)
# doesn't silently degrade into an empty data/ + missing memory:
#   - branch missing on remote (legitimate first run)   → log + continue
#   - fetch fails for any other reason                   → FATAL exit
#   - fetch ok but checkout fails                        → FATAL exit
echo "[entrypoint] hydrating data/ from data branch..."
if git fetch origin "data:refs/remotes/origin/data" --quiet; then
  if ! git checkout refs/remotes/origin/data -- data/; then
    echo "[entrypoint] FATAL: data branch fetched but checkout failed" >&2
    exit 1
  fi
elif git ls-remote --exit-code origin data >/dev/null 2>&1; then
  echo "[entrypoint] FATAL: data branch exists on remote but fetch failed" >&2
  exit 1
else
  echo "[entrypoint] data branch not found on remote — first-run bootstrap"
fi
mkdir -p data/reports data/staging

# Install deps only if package-lock.json is newer than last install.
# npm ci creates node_modules/.package-lock.json with the current timestamp,
# so a subsequent git pull that updates package-lock.json triggers reinstall.
LOCK_MARK="node_modules/.package-lock.json"
if [ ! -f "$LOCK_MARK" ] || [ "package-lock.json" -nt "$LOCK_MARK" ]; then
  echo "[entrypoint] installing npm dependencies..."
  npm ci --omit=dev --no-audit --no-fund --prefer-offline || {
    echo "[entrypoint] FATAL: npm ci failed — check Node version or network" >&2
    exit 1
  }
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
