#!/usr/bin/env bash
# Host-side cron wrapper. Invoked by a crontab entry like:
#
#   TZ=Asia/Taipei
#   0 4 * * * /home/bolin8017/ai-daily-report/scripts/cron-run.sh >> /var/log/ai-daily-report.log 2>&1
#
# Two-stage pipeline:
#   Stage 1 (collect): fetch + condense + snapshot → commit staging data
#   Stage 2 (analyze): claude agent reads staging data → writes editorial/report → commit
#
# Both stages run inside the same Docker container invocation.

set -euo pipefail

SECRETS_FILE="${HOME}/.ai-daily-report.env"
IMAGE="ai-daily-report:latest"
VOLUME="ai-daily-report-workspace"
CLAUDE_HOST_DIR="${HOME}/.claude"
HERMES_WIKI_HOST_ROOT="${HOME}/Documents/Hermes/Wiki/ai-daily-report"
HERMES_WIKI_CONTAINER_ROOT="/home/pipeline/Hermes/Wiki/ai-daily-report"
MEMORY_LIMIT="${PIPELINE_MEMORY_LIMIT:-600m}"
MEMORY_SWAP="${PIPELINE_MEMORY_SWAP:-1g}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ts() { date -Iseconds; }

# Keep the host clone current so Dependabot-merged changes to Dockerfile /
# package-lock.json propagate into the image-rebuild check below. Without
# this, image_needs_rebuild() would compare the image against a stale host
# clone (the Docker volume's separate clone does pull, but that's too late —
# the image is built from the host clone in this script).
# --ff-only fails loudly if the operator has uncommitted work on main, so we
# never silently discard local changes.
sync_host_clone() {
  if ! git -C "$REPO_DIR" fetch origin main --quiet 2>&1; then
    echo "[cron-run] $(ts) WARN: git fetch failed — continuing with cached clone" >&2
    return 0
  fi
  local local_sha remote_sha
  local_sha=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
  remote_sha=$(git -C "$REPO_DIR" rev-parse origin/main 2>/dev/null || echo "")
  if [ -n "$local_sha" ] && [ -n "$remote_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
    echo "[cron-run] $(ts) host clone ${local_sha:0:7} differs from origin/main ${remote_sha:0:7} — fast-forwarding"
    if ! git -C "$REPO_DIR" merge --ff-only origin/main 2>&1; then
      echo "[cron-run] $(ts) WARN: --ff-only failed (local divergence?) — continuing with current HEAD" >&2
      return 0
    fi
    # The fast-forward may have rewritten this very script. bash keeps
    # executing the file it already opened (the pre-update body), so a change
    # to cron-run.sh itself would otherwise only take effect on the NEXT daily
    # invocation. That one-cycle lag is exactly why the first VM run after the
    # 2026-06-01 event-driven-deploy cutover pushed the report but never fired
    # the Pages deploy dispatch — the dispatch step had only just landed in the
    # freshly pulled body. Re-exec the refreshed copy once so new wrapper logic
    # applies THIS cycle; AI_DAILY_REEXECED guards against any re-exec loop.
    if [ "${AI_DAILY_REEXECED:-0}" != "1" ] \
      && ! git -C "$REPO_DIR" diff --quiet "$local_sha" "$remote_sha" -- scripts/cron-run.sh; then
      echo "[cron-run] $(ts) cron-run.sh changed in fast-forward — re-exec'ing refreshed copy"
      export AI_DAILY_REEXECED=1
      exec "$REPO_DIR/scripts/cron-run.sh"
    fi
  fi
}

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

# The host-side AI_DAILY_REPORT_WIKI_ROOT variable is an optional host path
# override. Inside Docker we intentionally pass the fixed container mount path
# under the same variable name so build-report-context.mjs can find the Wiki.
HERMES_WIKI_HOST_ROOT="${AI_DAILY_REPORT_WIKI_ROOT:-$HERMES_WIKI_HOST_ROOT}"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[cron-run] FATAL: GITHUB_TOKEN not set in ${SECRETS_FILE}"
  exit 1
fi

if [ ! -d "$CLAUDE_HOST_DIR" ]; then
  echo "[cron-run] FATAL: ${CLAUDE_HOST_DIR} missing — run \`claude\` once interactively on the host to create it"
  exit 1
fi

# Create the workspace volume and Hermes Wiki root if they don't exist (idempotent)
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
mkdir -p "$HERMES_WIKI_HOST_ROOT"

# Pull latest main into the host clone, then rebuild image if
# Dockerfile/package-lock changed since last build
sync_host_clone
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
  -e FIRECRAWL_API_KEY \
  -e FIRECRAWL_DISABLED \
  -e REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}" \
  -e CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}" \
  -e AI_DAILY_REPORT_WIKI_ROOT="$HERMES_WIKI_CONTAINER_ROOT" \
  -v "$VOLUME":/workspace \
  -v "$HERMES_WIKI_HOST_ROOT":"$HERMES_WIKI_CONTAINER_ROOT" \
  -v "$CLAUDE_HOST_DIR":/home/pipeline/.claude \
  -v "${HOME}/.claude.json":/home/pipeline/.claude.json \
  "$IMAGE"

# The pipeline above committed + pushed today's report to the `data`
# branch. Fire the GitHub Pages deploy now via repository_dispatch instead
# of waiting for a scheduled poll — pushes to the orphan `data` branch
# can't trigger Actions, and GitHub's cron drifted by hours. Best-effort:
# a failed dispatch only logs a warning (the deploy still happens on the
# next successful run, a push to main, or a manual workflow_dispatch).
# repository_dispatch needs only the Contents:write scope $GITHUB_TOKEN
# already has for the push; `if curl` keeps set -e from aborting the run
# on a transient API hiccup. Reaches here only when `docker run` exited 0
# (set -e), i.e. the report was produced and pushed.
DEPLOY_REPO_SLUG="${DEPLOY_REPO_SLUG:-bolin8017/ai-daily-report}"
if curl -fsS -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${DEPLOY_REPO_SLUG}/dispatches" \
  -d '{"event_type":"data-committed"}'; then
  echo "[cron-run] $(ts) Pages deploy dispatched (repository_dispatch: data-committed)"
else
  echo "[cron-run] $(ts) WARN: deploy dispatch failed — site will lag until the next run or a manual deploy" >&2
fi

echo "[cron-run] $(ts) === run complete ==="
