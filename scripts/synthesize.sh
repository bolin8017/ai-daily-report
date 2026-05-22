#!/usr/bin/env bash
# Stage 3: Synthesize — single claude -p Sonnet call.
# Reads curated/* + raw staging + memory, writes v2.0 report + updated memory.
#
# Env:
#   CLAUDE_MODEL — model (default: claude-sonnet-4-6)
#   STAGING_DIR  — input (default: data/staging)
#   CURATED_DIR  — curated input dir (default: <STAGING_DIR>/curated)
#
# Exit: 0 ok | 1 claude failed | 2 schema validation failed | 3 missing input

set -uo pipefail

MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"
STAGING_DIR="${STAGING_DIR:-data/staging}"
CURATED_DIR="${CURATED_DIR:-${STAGING_DIR}/curated}"
TODAY="$(TZ=Asia/Taipei date +%F)"
REPORT_FILE="data/reports/${TODAY}.json"

LOG_DIR="$CURATED_DIR/.logs"
mkdir -p "$LOG_DIR" "data/reports"

for sec in shipped pulse; do
  if [ ! -f "$CURATED_DIR/$sec.json" ]; then
    echo "[synthesize.sh] Missing critical $sec.json — aborting" >&2
    exit 3
  fi
done

PROMPT_FILE="$LOG_DIR/synthesizer.prompt.txt"
# Assemble synthesizer prompt + daily-report-quality slop rules + explicit
# "Execute now" imperative. Without the imperative the model ack-chats; with
# it, the synthesizer immediately reads inputs and writes the report.
{
  cat .claude/synthesizer.md
  if [ -f .claude/daily-report-quality.md ]; then
    printf '\n\n---\n\n'
    cat .claude/daily-report-quality.md
  fi
  printf '\n\n---\n\n## Execute now\n\n'
  printf 'Today is %s. Use the Read tool on the inputs listed above. Synthesize the editorial layer (lead, signals, ideation) and copy curated sub-groups verbatim. Use the Write tool to write the full v2.0 report to `data/reports/%s.json` and the updated memory to `data/memory.json`.\n\n' "$TODAY" "$TODAY"
  printf 'Do not output prose, acknowledgement, or explanation. Begin with Read calls immediately. Final actions are two Write calls (report, then memory).\n'
} > "$PROMPT_FILE"

echo "[synthesize.sh] starting (model=$MODEL date=$TODAY)"

(
  claude -p \
    --model "$MODEL" \
    --output-format text \
    --allowed-tools Read Write Glob Grep \
    < "$PROMPT_FILE" \
    > "$LOG_DIR/synthesizer.raw.txt" \
    2> "$LOG_DIR/synthesizer.err.txt"
) &
CLAUDE_PID=$!

bash scripts/watchdog.sh "$CLAUDE_PID" > "$LOG_DIR/synthesizer.watchdog.log" 2>&1 &
WATCHDOG_PID=$!

wait "$CLAUDE_PID"
RC=$?
kill "$WATCHDOG_PID" 2>/dev/null || true

if [ "$RC" -ne 0 ]; then
  echo "[synthesize.sh] claude -p failed rc=$RC" >&2
  cat "$LOG_DIR/synthesizer.err.txt" >&2
  exit 1
fi

if [ ! -f "$REPORT_FILE" ]; then
  echo "[synthesize.sh] $REPORT_FILE missing — synthesizer didn't Write it" >&2
  exit 2
fi

if ! node -e "
  import('./src/schemas/report.js').then(async m => {
    const fs = await import('node:fs/promises');
    const report = JSON.parse(await fs.readFile('$REPORT_FILE','utf8'));
    m.ReportSchema.parse(report);
    console.log('[synthesize.sh] report validates against ReportSchema v2.0');
  }).catch(e => { console.error('[synthesize.sh] VALIDATION FAILED:', e.message); process.exit(2); });
"; then
  exit 2
fi

echo "[synthesize.sh] done. Report: $REPORT_FILE"
exit 0
