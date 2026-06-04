#!/usr/bin/env bash
# Orchestrates the LLM + merge stages: Stage 2 (curate) → Stage 3
# (synthesize → editorial.json) → Stage 4 (merge → report.json) →
# validate → commit report outputs to the data branch.
#
# Reads condensed data from data/staging/ (written by Stage 1). The active
# theme (themes/$ACTIVE_THEME/) supplies all prompts + section definitions.
#
# Prerequisites:
#   - Claude CLI authenticated (~/.claude valid)
#   - GITHUB_TOKEN set (for push)
#   - data/staging/ populated (by Stage 1)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck source=/dev/null
  set -a; source .env; set +a
fi

DATE=$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%Y-%m-%d)
SKIP_PUSH="${SKIP_PUSH:-0}"

echo "[analyze] $(date -Iseconds) — pipeline: curate → synthesize → merge (date=${DATE})"

if ! bash scripts/curate.sh; then
  echo "[analyze] FATAL: curate failed — aborting" >&2
  exit 1
fi

if ! bash scripts/synthesize.sh; then
  echo "[analyze] FATAL: synthesize failed — aborting" >&2
  exit 1
fi

# Synthesizer wrote editorial.json only. Compose the final report.json
# mechanically from editorial + curated/*.json.
echo "[analyze] composing report from editorial + curated"
if ! bash scripts/merge-report.sh "$DATE"; then
  echo "[analyze] FATAL: merge-report failed — aborting" >&2
  exit 1
fi

REPORT_FILE="data/reports/${DATE}.json"

# ── Commit + push to data branch ──────────────────────────────────
# src/lib/commit.js builds the commit with git plumbing so main's
# working tree and index are never touched. Bot artifacts live on
# the `data` orphan branch.
if [ "$SKIP_PUSH" = "1" ]; then
  echo "[analyze] SKIP_PUSH — skipping commit and push"
else
  COMMIT_PATHS=()
  [ -f "$REPORT_FILE" ] && COMMIT_PATHS+=("$REPORT_FILE")
  # feeds-snapshot.json drives the footer source-status pills + community
  # feed lists at 11ty build time. Stage 1 rebuilds it every run; it's
  # otherwise volume-only, but CI builds from the data branch, so commit it
  # too or the footer renders a frozen snapshot (it had been stuck on the
  # last pre-cutover commit, showing stale source counts).
  [ -f "data/feeds-snapshot.json" ] && COMMIT_PATHS+=("data/feeds-snapshot.json")
  if [ "${#COMMIT_PATHS[@]}" -eq 0 ]; then
    echo "[analyze] no outputs to commit — exiting nonzero" >&2
    exit 1
  fi
  echo "[analyze] committing ${#COMMIT_PATHS[@]} files to data branch..."
  node src/lib/commit.js "$DATE" "report: ${DATE} daily creative brief" "${COMMIT_PATHS[@]}"
fi

echo "[analyze] $(date -Iseconds) — done"
