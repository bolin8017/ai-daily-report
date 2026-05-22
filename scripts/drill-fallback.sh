#!/usr/bin/env bash
# scripts/drill-fallback.sh — verify fallback chains actually work end-to-end
# by disabling a primary provider and checking telemetry confirms fallback
# to a later tier.
#
# Usage:
#   bash scripts/drill-fallback.sh rsshub      # disable rsshub via unreachable URL
#   bash scripts/drill-fallback.sh firecrawl   # disable firecrawl env flag
#
# Output: prints which sources fell back from tier 0 to which downstream tier,
# plus which sources failed entirely. Useful as a periodic (quarterly) drill
# to make sure cloud fallbacks haven't silently broken.

set -euo pipefail

MODE="${1:-rsshub}"
export SKIP_PUSH=1

case "$MODE" in
  rsshub)
    # Force rsshub provider to fail by pointing at an unreachable host
    export RSSHUB_URL="https://drill-rsshub-not-real.invalid"
    echo "[drill] rsshub forced to unreachable URL"
    ;;
  firecrawl)
    export FIRECRAWL_DISABLED=1
    echo "[drill] firecrawl disabled"
    ;;
  jina)
    export JINA_DISABLED=1
    echo "[drill] jina disabled"
    ;;
  *)
    echo "unknown drill mode: $MODE" >&2
    echo "usage: $0 [rsshub|firecrawl|jina]" >&2
    exit 1
    ;;
esac

node src/collect.js --skip-push 2>&1 | tail -5
echo

DATE=$(date +%F)
TELEMETRY="data/runs/$DATE.json"

if [[ ! -f "$TELEMETRY" ]]; then
  echo "FAIL: no telemetry written to $TELEMETRY" >&2
  exit 1
fi

echo "--- Sources that fell back ---"
jq '.sources[] | select(.tier_used > 0) | {source_id, tier_used, provider, fallback_reason}' "$TELEMETRY"

echo
echo "--- Sources that failed entirely ---"
jq '.sources[] | select(.tier_used == -1) | {source_id, fallback_reason}' "$TELEMETRY"

echo
echo "--- Summary ---"
jq '.summary' "$TELEMETRY"
