#!/usr/bin/env bash
# Shadow vs Production diff helper.
# Compare a shadow-pipeline report (new architecture, written locally) against
# the production report on the data branch for the same date.
#
# Usage: scripts/shadow-diff.sh [YYYY-MM-DD]
#
# If no date provided, uses today's Asia/Taipei date.

set -euo pipefail
cd "$(dirname "$0")/.."

DATE="${1:-$(TZ=Asia/Taipei date +%F)}"
SHADOW="data/reports/$DATE.json"
PROD_REF="data/reports/.shadow-baseline/$DATE.json"

if [ ! -f "$SHADOW" ]; then
  echo "Shadow missing: $SHADOW" >&2
  exit 1
fi

if [ ! -f "$PROD_REF" ]; then
  mkdir -p data/reports/.shadow-baseline
  git fetch origin data:refs/remotes/origin/data 2>/dev/null || true
  if ! git show "origin/data:data/reports/$DATE.json" > "$PROD_REF" 2>/dev/null; then
    echo "No production baseline for $DATE on data branch — nothing to compare against"
    rm -f "$PROD_REF"
    exit 0
  fi
fi

echo "=== Shadow vs Production diff for $DATE ==="
node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('$SHADOW','utf8'));
const b = JSON.parse(fs.readFileSync('$PROD_REF','utf8'));
function summary(r, label){
  console.log('--- ' + label + ' ---');
  console.log('  schema_version:', r.schema_version ?? '<v1>');
  if (r.schema_version === 2) {
    console.log('  signals.focus:', (r.signals?.focus ?? []).length);
    console.log('  signals.predictions:', (r.signals?.predictions ?? []).length);
    console.log('  ideation.general:', (r.ideation?.general ?? []).length);
    console.log('  ideation.work:', (r.ideation?.work ?? []).length);
    console.log('  shipped.trending:', (r.shipped?.trending ?? []).length);
    console.log('  pulse.hn:', (r.pulse?.hn ?? []).length);
    console.log('  market.taiwan:', (r.market?.taiwan ?? []).length);
    console.log('  tech.aidaptiv:', (r.tech?.aidaptiv ?? []).length);
  } else {
    console.log('  (legacy v1.x report)');
    console.log('  ideas:', (r.ideas ?? []).length);
    console.log('  shipped:', (r.shipped ?? []).length);
    console.log('  signals:', (r.signals ?? []).length);
    console.log('  predictions:', (r.predictions ?? []).length);
  }
}
summary(a,'shadow');
summary(b,'production');
"
