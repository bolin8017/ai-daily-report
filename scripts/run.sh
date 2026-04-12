#!/usr/bin/env bash
# Local development wrapper for the two-stage pipeline.
#
# Production runs inside the Docker image on the VM (invoked by cron via
# scripts/cron-run.sh). This script is for local iteration on fetchers,
# prompts, or templates.
#
# Usage:
#   bash scripts/run.sh               # Stage 1 only (collect, no push)
#   bash scripts/run.sh --full        # Stage 1 + Stage 2 (requires `claude` logged in)
#   bash scripts/run.sh --skip-push   # Stage 1 + Stage 2 but no git push
#   bash scripts/run.sh --analyze     # Stage 2 only (assumes staging data exists)
#
# The `npm start` script maps to `bash scripts/run.sh` with no args.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck source=/dev/null
  set -a; source .env; set +a
fi

MODE="collect-only"
export SKIP_PUSH=1

for arg in "$@"; do
  case "$arg" in
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
      unset SKIP_PUSH
      ;;
    *)
      echo "unknown flag: $arg" >&2
      echo "usage: run.sh [--full | --skip-push | --analyze]" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  collect-only)
    echo "[run] Stage 1 only (collect, --skip-push)"
    node src/collect.js --skip-push
    ;;
  full)
    echo "[run] Stage 1 + Stage 2"
    node src/collect.js
    bash scripts/analyze.sh
    ;;
  analyze-only)
    echo "[run] Stage 2 only (analyze)"
    bash scripts/analyze.sh
    ;;
esac
