#!/usr/bin/env bash
# Stage 2.5: Context — build the bounded report-context.md from the local Hermes
# Wiki + today's curated evidence. No LLM. Extracted from synthesize.sh so the
# pipeline runs/observes it as its own stage. Inherits AI_DAILY_REPORT_WIKI_ROOT
# from the caller (run.sh / prod-start) when set; otherwise build-report-context.mjs
# falls back to its default Wiki path.
#
# Exit: 0 ok | 3 context generation failed
set -uo pipefail
cd "$(dirname "$0")/.."

STAGING_DIR="${STAGING_DIR:-data/staging}"
TODAY="$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%F)"

echo "[context] building report-context (date=$TODAY)"
if ! node scripts/hermes/build-report-context.mjs --date "$TODAY" --staging-dir "$STAGING_DIR"; then
  echo "[context] report-context generation failed" >&2
  exit 3
fi
echo "[context] wrote ${STAGING_DIR}/report-context.md"
