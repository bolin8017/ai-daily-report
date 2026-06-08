#!/usr/bin/env bash
# Stage 3: Synthesize — single claude -p Sonnet call.
# Reads curated/* + raw staging + bounded Hermes report-context, writes ONLY
# the editorial layer (lead/signals) to data/staging/editorial.json.
# Stage 4 (merge-report.sh) composes the final report from editorial +
# curated/*; the synthesizer never re-emits curated content or writes legacy memory.
#
# Env:
#   CLAUDE_MODEL — model (default: claude-sonnet-4-6)
#   STAGING_DIR  — input (default: data/staging)
#   CURATED_DIR  — curated input dir (default: <STAGING_DIR>/curated)
#   CLAUDE_CODE_MAX_OUTPUT_TOKENS — output cap (default: 64000)
#
# Exit: 0 ok | 1 claude failed | 2 schema validation failed | 3 missing input

set -uo pipefail

MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"
STAGING_DIR="${STAGING_DIR:-data/staging}"
CURATED_DIR="${CURATED_DIR:-${STAGING_DIR}/curated}"
FALLBACK_MODEL="${SYNTH_FALLBACK_MODEL:-sonnet}"
# Lean-context flags: see curate.sh — --bare drops auth in our env, so use
# --strict-mcp-config (keeps auth + Read/Write/Glob/Grep).
LEAN_FLAGS=(--strict-mcp-config --mcp-config '{"mcpServers":{}}')
TODAY="$(TZ=Asia/Taipei date +%F)"
REPORT_FILE="data/reports/${TODAY}.json"
EDITORIAL_FILE="${STAGING_DIR}/editorial.json"
REPORT_CONTEXT_FILE="${STAGING_DIR}/report-context.md"

# CLI default output cap is 32K. The editorial-only output rarely exceeds
# ~6K tokens (curated bundles are no longer in the synth output — that's
# what blew the 32K cap on 2026-05-24), but keep 64K headroom in case the
# editorial layer grows. 64K is Sonnet 4.6's native max output.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS="${CLAUDE_CODE_MAX_OUTPUT_TOKENS:-64000}"

# Resolve prompt paths from the active theme bundle.
ACTIVE_THEME="${ACTIVE_THEME:-ai-builder}"
SYNTH_PROMPT_FILE_PATH="themes/${ACTIVE_THEME}/synthesizer.md"
QUALITY_FILE_PATH="themes/${ACTIVE_THEME}/quality.md"

LOG_DIR="$CURATED_DIR/.logs"
mkdir -p "$LOG_DIR" "data/reports"

for sec in shipped pulse; do
  if [ ! -f "$CURATED_DIR/$sec.json" ]; then
    echo "[synthesize.sh] Missing critical $sec.json — aborting" >&2
    exit 3
  fi
done

PROMPT_FILE="$LOG_DIR/synthesizer.prompt.txt"

if ! node scripts/hermes/build-synthesizer-prompt.mjs \
  --date "$TODAY" \
  --theme "$ACTIVE_THEME" \
  --editorial-file "$EDITORIAL_FILE" \
  --report-context-file "$REPORT_CONTEXT_FILE" \
  --synth-prompt "$SYNTH_PROMPT_FILE_PATH" \
  --quality "$QUALITY_FILE_PATH" \
  --output "$PROMPT_FILE"; then
  echo "[synthesize.sh] prompt generation failed" >&2
  exit 3
fi

echo "[synthesize.sh] starting (model=$MODEL date=$TODAY)"

# NB: extended thinking stays OFF for this synthesis call — reasoning mode
# raises hallucination on source-faithful summarization. (The Stage 3.5 judge
# call may use it; synthesis must not.)
(
  claude -p \
    --model "$MODEL" \
    --fallback-model "$FALLBACK_MODEL" \
    --output-format json \
    --tools "Read,Write,Glob,Grep" \
    --allowed-tools Read Write Glob Grep \
    --no-session-persistence \
    "${LEAN_FLAGS[@]}" \
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

node src/lib/claude-envelope.js sidecar "$LOG_DIR/synthesizer.raw.txt" "$LOG_DIR/synthesize.meta.json" "synthesize" 2>/dev/null || true

if [ "$RC" -ne 0 ]; then
  echo "[synthesize.sh] claude -p failed rc=$RC" >&2
  cat "$LOG_DIR/synthesizer.err.txt" >&2
  exit 1
fi

if [ ! -f "$EDITORIAL_FILE" ]; then
  echo "[synthesize.sh] $EDITORIAL_FILE missing — synthesizer didn't Write it" >&2
  exit 2
fi

# Safety net: repair known synthesizer drift before schema validation rather
# than throwing away an expensive synthesis. With Hermes Wiki migration, legacy
# memory is no longer an input; terse/unknown prediction updates are dropped
# unless report-context supplied complete prediction details.
node --input-type=module -e "
  import { readFile, writeFile } from 'node:fs/promises';
  import { repairEditorial } from './src/lib/repair-editorial.js';
  const doc = JSON.parse(await readFile('$EDITORIAL_FILE', 'utf8'));
  const r = repairEditorial(doc);
  if (r.statusCoerced || r.dropped) {
    await writeFile('$EDITORIAL_FILE', JSON.stringify(doc, null, 2));
    console.error('[synthesize.sh] repaired editorial: statusCoerced=' + r.statusCoerced + ' dropped=' + r.dropped);
  }
"

if ! node -e "
  import('./src/schemas/editorial.js').then(async m => {
    const fs = await import('node:fs/promises');
    const doc = JSON.parse(await fs.readFile('$EDITORIAL_FILE','utf8'));
    m.EditorialSchema.parse(doc);
    console.log('[synthesize.sh] editorial validates against EditorialSchema 2.1-editorial');
  }).catch(e => { console.error('[synthesize.sh] EDITORIAL VALIDATION FAILED:', e.message); process.exit(2); });
"; then
  exit 2
fi

echo "[synthesize.sh] done. editorial: $EDITORIAL_FILE"
exit 0
