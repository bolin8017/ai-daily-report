#!/usr/bin/env bash
# Stage 4: mechanical merge of editorial.json + curated/*.json →
# data/reports/<date>.json. No LLM, no token cap, no nondeterminism.
# Invoked by the sequencer (src/pipeline/run.js) after Stage 3 (synthesize) succeeds.
#
# Usage:
#   bash scripts/merge-report.sh [DATE]
#
#   DATE defaults to today in REPORT_TIMEZONE (default Asia/Taipei; matches Stage 1).
#
# Exits:
#   0  — report written and validated
#   1  — input missing
#   2  — editorial validation failed
#   3  — dangling source_link
#   4  — composed report failed schema validation

set -uo pipefail
cd "$(dirname "$0")/.."

DATE="${1:-$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%F)}"
STAGING_DIR="${STAGING_DIR:-data/staging}"
CURATED_DIR="${CURATED_DIR:-${STAGING_DIR}/curated}"
EDITORIAL_FILE="${EDITORIAL_FILE:-${STAGING_DIR}/editorial.json}"
REPORT_FILE="data/reports/${DATE}.json"
ACTIVE_THEME="${ACTIVE_THEME:-ai-builder}"

if [ ! -f "$EDITORIAL_FILE" ]; then
  echo "[merge-report] FATAL: editorial input missing at $EDITORIAL_FILE" >&2
  exit 1
fi

for sec in shipped pulse market tech catalog; do
  if [ ! -f "$CURATED_DIR/$sec.json" ]; then
    echo "[merge-report] WARN: curated/$sec.json missing — section will be empty" >&2
  fi
done

mkdir -p data/reports

echo "[merge-report] composing date=$DATE theme=$ACTIVE_THEME"

node --input-type=module -e "
import {readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {composeReport} from './src/lib/merge.js';
import {aggregateMeta} from './src/lib/report-meta.js';
import {appendSeen} from './src/lib/seen-repos.js';
import {canonicalRepoKey} from './src/lib/repo-key.js';

const editorial = JSON.parse(readFileSync('$EDITORIAL_FILE', 'utf8'));
const curated = {};
for (const sec of ['shipped', 'pulse', 'market', 'tech', 'catalog']) {
  const p = '$CURATED_DIR/' + sec + '.json';
  curated[sec] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

// Observability: assemble report.meta from Stage-1 staging identity/health +
// per-stage usage sidecars (written by claude-envelope.js after each claude -p
// call). Entirely best-effort — any read failure leaves meta partial or null.
let stagingMeta = {};
try { stagingMeta = JSON.parse(readFileSync('$STAGING_DIR/metadata.json', 'utf8')); } catch {}
const stages = {};
try {
  for (const f of readdirSync('$CURATED_DIR/.logs')) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const s = JSON.parse(readFileSync('$CURATED_DIR/.logs/' + f, 'utf8'));
      if (s && s.stage) { const {stage, ...rest} = s; stages[stage] = rest; }
    } catch {}
  }
} catch {}
const meta = aggregateMeta({
  stagingMeta,
  stages,
  model: process.env.CLAUDE_MODEL || process.env.MODEL,
  generatedAt: new Date().toISOString(),
  analyzeDurationMs: Number(process.env.ANALYZE_DURATION_MS) || undefined,
});

try {
  const report = await composeReport({editorial, curated, themeName: '$ACTIVE_THEME', meta});
  writeFileSync('$REPORT_FILE', JSON.stringify(report, null, 2) + '\n');
  console.log('[merge-report] wrote $REPORT_FILE schema_version=' + report.schema_version + (meta ? ' meta=yes stages=' + Object.keys(meta.stages || {}).length : ' meta=no'));
  try {
    const picks = Array.isArray(report.catalog?.picks) ? report.catalog.picks : [];
    const shown = picks.map((p) => ({ repo: canonicalRepoKey(p) ?? p.name, stars: p.stars })).filter((p) => p.repo);
    if (shown.length) {
      const { added, total } = appendSeen(shown, '$DATE');
      console.log('[merge-report] seen-repos +' + added + ' (total ' + total + ')');
    }
  } catch (e) {
    console.error('[merge-report] WARN: seen-repos ledger update failed (report still written): ' + e.message);
  }
} catch (e) {
  if (/dangling source_link/.test(e.message)) {
    console.error('[merge-report] ' + e.message);
    process.exit(3);
  }
  if (e.name === 'ZodError') {
    console.error('[merge-report] schema validation failed:');
    for (const iss of e.issues.slice(0, 10)) {
      console.error('  - ' + iss.path.join('.') + ': ' + iss.message);
    }
    process.exit(4);
  }
  console.error('[merge-report] ' + e.message);
  process.exit(2);
}
"
RC=$?
if [ "$RC" -ne 0 ]; then
  exit "$RC"
fi

echo "[merge-report] done."
exit 0
