#!/usr/bin/env bash
# Stage 2: Analysis. Invokes Claude Code to produce the daily report.
#
# Reads condensed data from data/staging/ (committed by Stage 1),
# assembles the agent prompt + quality rules, invokes claude -p with
# tool access, then validates output and commits.
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
MODEL="${CLAUDE_MODEL:-claude-opus-4-6}"
SKIP_PUSH="${SKIP_PUSH:-0}"
ANALYZE_STARTED_MS=$(date +%s%3N)

# ── Preflight checks ──────────────────────────────────────────────

for f in data/staging/metadata.json .claude/agents/daily-report.md .claude/daily-report-quality.md; do
  if [ ! -f "$f" ]; then
    echo "[analyze] FATAL: ${f} not found" >&2
    exit 1
  fi
done

STAGING_DATE=$(node -e "
  const d = JSON.parse(require('fs').readFileSync('data/staging/metadata.json','utf8')).date;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { console.error('[analyze] FATAL: staging metadata missing or invalid date field'); process.exit(1); }
  console.log(d);
")
if [ "$STAGING_DATE" != "$DATE" ]; then
  if [ "${ALLOW_STALE:-0}" = "1" ]; then
    echo "[analyze] WARN: staging data is from ${STAGING_DATE}, today is ${DATE} (--allow-stale)" >&2
  else
    echo "[analyze] FATAL: staging data is from ${STAGING_DATE}, today is ${DATE}. Set ALLOW_STALE=1 to override." >&2
    exit 1
  fi
fi

echo "[analyze] $(date -Iseconds) — starting analysis for ${DATE} (model: ${MODEL})"

# ── Build prompt ──────────────────────────────────────────────────
# Concatenate agent prompt + quality rules + today's date, then pipe
# to claude -p with tool access. The agent reads data files via the
# Read tool, analyzes per Steps 2-7, and writes output via Write.

PROMPT_FILE=$(mktemp /tmp/analyze-prompt-XXXXXX.txt)
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  cat .claude/agents/daily-report.md
  printf '\n---\n\n## Quality rules (must not violate)\n\n'
  cat .claude/daily-report-quality.md
  printf '\n---\n\n## Today'\''s date: %s\n' "$DATE"
  printf '\nExecute the workflow above. Read input files, analyze the data, and write output files.\n'
} > "$PROMPT_FILE"

# ── Invoke Claude ─────────────────────────────────────────────────

CLAUDE_EXIT=0
claude -p \
  --output-format text \
  --model "$MODEL" \
  --allowedTools Read Write Grep Glob \
  < "$PROMPT_FILE" || CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  echo "[analyze] FATAL: claude -p exited with code ${CLAUDE_EXIT}" >&2
  exit "$CLAUDE_EXIT"
fi

ANALYZE_FINISHED_MS=$(date +%s%3N)
ANALYZE_DURATION_MS=$((ANALYZE_FINISHED_MS - ANALYZE_STARTED_MS))
echo "[analyze] $(date -Iseconds) — claude session complete (${ANALYZE_DURATION_MS}ms)"

# ── Validate output ───────────────────────────────────────────────

REPORT_FILE="data/reports/${DATE}.json"

if [ ! -f "$REPORT_FILE" ]; then
  echo "[analyze] FATAL: ${REPORT_FILE} not created by agent" >&2
  exit 1
fi

# Inject observability metadata from staging + timing (before validation so
# the schema check covers the meta block too). Staging metadata carries the
# run_id and pipeline_version generated at Stage 1 start; analyze.sh adds
# model + timings. Skips injection silently if the staging data predates the
# observability upgrade (no run_id present) — meta is optional in the schema.
echo "[analyze] injecting meta block..."
ANALYZE_DURATION_MS="$ANALYZE_DURATION_MS" \
MODEL="$MODEL" \
REPORT_FILE="$REPORT_FILE" \
node -e '
  const fs = require("node:fs");
  const staging = JSON.parse(fs.readFileSync("data/staging/metadata.json", "utf8"));
  const reportPath = process.env.REPORT_FILE;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!staging.run_id || !staging.pipeline_version) {
    console.error("[analyze] staging lacks run_id/pipeline_version — skipping meta injection");
    return;
  }
  report.meta = {
    run_id: staging.run_id,
    pipeline_version: staging.pipeline_version,
    model: process.env.MODEL,
    generated_at: new Date().toISOString(),
    analyze_duration_ms: Number(process.env.ANALYZE_DURATION_MS),
    source_health: staging.sources,
    degraded_sources: staging.degraded || [],
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.error(`[analyze] meta injected: run_id=${report.meta.run_id.slice(0,8)} version=${report.meta.pipeline_version}`);
'

echo "[analyze] validating report..."
node src/lib/validate.js report "$REPORT_FILE"

echo "[analyze] validating memory..."
node src/lib/validate.js memory data/memory.json

# ── Commit + push to data branch ──────────────────────────────────
# src/lib/commit.js builds the commit with git plumbing so main's
# working tree and index are never touched. Bot artifacts live on
# the `data` orphan branch.

if [ "$SKIP_PUSH" = "1" ]; then
  echo "[analyze] SKIP_PUSH — skipping commit and push"
else
  echo "[analyze] committing report to data branch..."
  node src/lib/commit.js "$DATE" "report: ${DATE} daily creative brief" \
    "$REPORT_FILE" "data/memory.json"
fi

echo "[analyze] $(date -Iseconds) — done"
