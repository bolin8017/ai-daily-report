#!/usr/bin/env bash
# Stage 3: Synthesize — single claude -p Sonnet call.
# Reads curated/* + raw staging + memory, writes v2.0 report + updated memory.
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
TODAY="$(TZ=Asia/Taipei date +%F)"
REPORT_FILE="data/reports/${TODAY}.json"
EDITORIAL_FILE="${STAGING_DIR}/editorial.json"

# CLI default 32K output cap truncates the synthesizer once curated bundles +
# editorial layer exceed it. Sonnet 4.6's native cap is 64K.
# (Phase 2 FEATURE_MERGE_STEP=1 removes curated bundles from synth output,
# so editorial-only output rarely exceeds 6K — but keeping the headroom
# in case editorial grows.)
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
# Assemble synthesizer prompt + quality slop rules + explicit "Execute
# now" imperative. The synthesizer writes only the editorial layer
# (lead/signals/ideation) to data/staging/editorial.json; a downstream
# merge step composes the final report from editorial + curated/*.json.
# Without the imperative the model ack-chats; with it, the synthesizer
# immediately reads inputs and writes the output.
{
  cat "$SYNTH_PROMPT_FILE_PATH"
  if [ -f "$QUALITY_FILE_PATH" ]; then
    printf '\n\n---\n\n'
    cat "$QUALITY_FILE_PATH"
  fi
  printf '\n\n---\n\n## Execute now\n\n'
  printf 'Today is %s. Use the Read tool on the inputs listed above (curated/*.json + staging files + memory).\n\n' "$TODAY"
  printf '**OUTPUT CONTRACT:**\n\n'
  printf '- Write to `%s` ONLY the editorial layer:\n' "$EDITORIAL_FILE"
  printf '  - `schema_version: "2.1-editorial"` (string literal)\n'
  printf '  - `date: "%s"` (string)\n' "$TODAY"
  printf '  - `theme: "%s"` (string)\n' "$ACTIVE_THEME"
  printf '  - `lead: {html: "..."}`\n'
  printf '  - `signals: {focus, sleeper, contrarian, predictions, prediction_updates}`\n'
  printf '  - `ideation: {general, work}`\n\n'
  printf '- Do NOT include `shipped`, `pulse`, `market`, `tech` sections in editorial.json. These are merged in by a separate step that runs after this one.\n\n'
  printf '- Reference items in `source_links` by their **stable ids** (e.g., `shipped.trending.0:vllm-project/vllm`) — read the ids from `data/staging/curated/*.json`. The merge step validates every source_link id; dangling links abort the pipeline.\n\n'
  printf '- Also write updated memory to `data/memory.json`.\n\n'
  printf 'Final actions are two Write calls (editorial, then memory). Do not output prose, acknowledgement, or explanation. Begin with Read calls immediately.\n'
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

if [ ! -f "$EDITORIAL_FILE" ]; then
  echo "[synthesize.sh] $EDITORIAL_FILE missing — synthesizer didn't Write it" >&2
  exit 2
fi

# Safety net: Sonnet occasionally drifts on `status` enum (e.g. invents
# "needs_revision"). Coerce unknown values to "unverifiable" before schema
# validation rather than throwing away 35 minutes of synthesis.
node -e "
  import('node:fs/promises').then(async fs => {
    const VALID = new Set(['pending', 'resolved-yes', 'resolved-no', 'unverifiable']);
    const doc = JSON.parse(await fs.readFile('$EDITORIAL_FILE', 'utf8'));
    let fixed = 0;
    for (const key of ['predictions', 'prediction_updates']) {
      for (const p of doc.signals?.[key] ?? []) {
        if (p && typeof p.status === 'string' && !VALID.has(p.status)) {
          console.error('[synthesize.sh] coercing status=\"' + p.status + '\" -> unverifiable on ' + (p.id ?? '?'));
          p.status = 'unverifiable';
          fixed++;
        }
      }
    }
    if (fixed > 0) {
      await fs.writeFile('$EDITORIAL_FILE', JSON.stringify(doc, null, 2));
      console.error('[synthesize.sh] coerced ' + fixed + ' invalid status value(s)');
    }
  });
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
