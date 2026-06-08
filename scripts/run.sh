#!/usr/bin/env bash
# Local development wrapper for the two-stage pipeline.
#
# Production runs under Hermes cron (07:00 Asia/Taipei). This script is
# for local iteration on fetchers, prompts, or templates.
#
# Usage:
#   bash scripts/run.sh                  # Stage 1 only (collect, no push)
#   bash scripts/run.sh --full           # Stage 1 + Stage 2 (requires `claude` logged in)
#   bash scripts/run.sh --skip-push      # Stage 1 + Stage 2 but no git push
#   bash scripts/run.sh --analyze        # Stage 2 only (assumes staging data exists)
#   bash scripts/run.sh --recover-from <stage>  # re-run <stage> + downstream, then publish
#   bash scripts/run.sh --curate-only    # Stage 2 only (curate)
#   bash scripts/run.sh --context-only   # Stage 2.5 only (build report-context)
#   bash scripts/run.sh --synthesize-only # Stage 2.5 + Stage 3 (context + synthesize)
#
# The `npm start` script maps to `bash scripts/run.sh` with no args.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck source=/dev/null
  set -a; source .env; set +a
fi

DATE=$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%F)

# Commit the day's report + feeds snapshot to the data branch (the publish tail,
# previously part of the analyze orchestrator). Gated by SKIP_PUSH so dev modes
# never publish. The sequencer runs to merge first; with set -e a sequencer
# failure aborts run.sh before this is reached, so a failed run never publishes.
commit_outputs() {
  local date="$1"
  if [ "${SKIP_PUSH:-0}" = "1" ]; then
    echo "[run] SKIP_PUSH — skipping commit and push"
    return 0
  fi
  local report_file="data/reports/${date}.json"
  local commit_paths=()
  [ -f "$report_file" ] && commit_paths+=("$report_file")
  [ -f "data/feeds-snapshot.json" ] && commit_paths+=("data/feeds-snapshot.json")
  [ -f "data/seen-repos.json" ] && commit_paths+=("data/seen-repos.json")
  if [ "${#commit_paths[@]}" -eq 0 ]; then
    echo "[run] no outputs to commit — exiting nonzero" >&2
    return 1
  fi
  echo "[run] committing ${#commit_paths[@]} files to data branch..."
  node src/lib/commit.js "$date" "report: ${date} daily creative brief" "${commit_paths[@]}"
}

# Capture any caller-supplied SKIP_PUSH intent BEFORE we set the script default,
# so a publish-capable mode (--recover-from) can honor a deliberate
# `SKIP_PUSH=1 bash run.sh ...` rehearsal instead of always publishing.
ORIG_SKIP_PUSH="${SKIP_PUSH:-}"
MODE="collect-only"
RECOVER_STAGE=""
export SKIP_PUSH=1

# Publish unless the caller explicitly asked to skip (SKIP_PUSH=1 in the env).
publish_unless_skip() {
  if [ "$ORIG_SKIP_PUSH" = "1" ]; then export SKIP_PUSH=1; else unset SKIP_PUSH; fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --full)
      MODE="full"
      unset SKIP_PUSH
      ;;
    --skip-push)
      MODE="full"
      export SKIP_PUSH=1
      ;;
    --analyze)
      MODE="analyze-only"
      # Keep SKIP_PUSH=1 default; use --full for push
      ;;
    --recover-from)
      # Operator escape hatch: re-run one stage + its downstream, then publish.
      # Auto-recovery is the sequencer's job; this is the manual equivalent.
      MODE="recover-from"
      shift
      RECOVER_STAGE="${1:-}"
      if [ -z "$RECOVER_STAGE" ]; then
        echo "[run] --recover-from requires a <stage> argument" >&2
        exit 1
      fi
      publish_unless_skip
      ;;
    --curate-only)
      MODE="curate-only"
      ;;
    --synthesize-only)
      MODE="synthesize-only"
      ;;
    --context-only)
      MODE="context-only"
      ;;
    *)
      echo "unknown flag: $1" >&2
      echo "usage: run.sh [--full | --skip-push | --analyze | --recover-from <stage> | --curate-only | --context-only | --synthesize-only]" >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  collect-only)
    echo "[run] Stage 1 only (collect, --skip-push)"
    node src/collect.js --skip-push
    ;;
  full)
    echo "[run] Stage 1 (collect) + sequencer (curate → context → synthesize → faithfulness → merge)"
    node src/collect.js
    node src/pipeline/run.js --resume --auto-recover
    commit_outputs "$DATE"
    ;;
  recover-from)
    echo "[run] recover: sequencer --from $RECOVER_STAGE (+ downstream), then publish"
    node src/pipeline/run.js --from "$RECOVER_STAGE"
    commit_outputs "$DATE"
    ;;
  analyze-only)
    echo "[run] sequencer --resume (Stages 2-4; assumes data/staging/ is populated)"
    node src/pipeline/run.js --resume
    # No commit_outputs here — --analyze is no-push by design; use --full to publish.
    ;;
  curate-only)
    echo "[run] Stage 2 only (curate)"
    bash scripts/curate.sh
    ;;
  synthesize-only)
    echo "[run] Stage 2.5 + Stage 3 (context + synthesize)"
    bash scripts/context.sh
    bash scripts/synthesize.sh
    ;;
  context-only)
    echo "[run] Stage 2.5 only (context)"
    bash scripts/context.sh
    ;;
esac
