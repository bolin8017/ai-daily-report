#!/usr/bin/env bash
# Local development wrapper around the pipeline.
#
# Production runs inside the Docker image on the VM (invoked by cron via
# scripts/cron-run.sh). This script is only for local iteration on fetchers,
# prompts, or templates. By default it stops before the `claude -p` synthesis
# step so you don't burn LLM quota during dev; pass --full to run end-to-end.
#
# Usage:
#   bash scripts/run.sh               # fetch + snapshot + condense only (dry run)
#   bash scripts/run.sh --full        # complete pipeline (requires `claude` logged in)
#   bash scripts/run.sh --skip-push   # full pipeline but no git push at the end
#
# The `npm start` script maps to `bash scripts/run.sh` with no args.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; source .env; set +a
fi

FLAGS=("--dry-run")
for arg in "$@"; do
  case "$arg" in
    --full) FLAGS=() ;;
    --skip-push) FLAGS=("--skip-push") ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

exec node src/pipeline.js "${FLAGS[@]}"
