#!/usr/bin/env bash
# Stage 3: Synthesize — single claude -p Sonnet call.
# Reads curated/* + raw staging + memory, writes ONLY the editorial layer
# (lead/signals/ideation) to data/staging/editorial.json + updated memory.
# Stage 4 (merge-report.sh) composes the final report from editorial +
# curated/*; the synthesizer never re-emits curated content.
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
  # Use a heredoc rather than per-line printf — printf treats argument
  # starting with "-" as a flag, which silently dropped the OUTPUT
  # CONTRACT bullets in a prior version of this script.
  cat <<EOF


---

## Execute now

Today is ${TODAY}. Use the Read tool on the inputs listed above (curated/*.json + staging files + memory).

**OUTPUT CONTRACT:**

- Write to \`${EDITORIAL_FILE}\` ONLY the editorial layer:
  - \`schema_version: "2.1-editorial"\` (string literal)
  - \`date: "${TODAY}"\` (string)
  - \`theme: "${ACTIVE_THEME}"\` (string)
  - \`lead: {html: "..."}\`
  - \`signals: {focus, sleeper, contrarian, predictions, prediction_updates}\`
  - \`ideation: {general, work}\`

- Do NOT include \`shipped\`, \`pulse\`, \`market\`, \`tech\` sections in editorial.json. These are merged in by a separate step that runs after this one.

- Reference items in \`source_links\` by their **stable ids** (e.g., \`shipped.trending.0:vllm-project/vllm\`) — read the ids from \`data/staging/curated/*.json\`. The merge step validates every source_link id; dangling links abort the pipeline.

- Also write updated memory to \`data/memory.json\`.

Final actions are two Write calls (editorial, then memory). Do not output prose, acknowledgement, or explanation. Begin with Read calls immediately.
EOF
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

# Safety net: repair known synthesizer drift before schema validation rather
# than throwing away an expensive synthesis. repairEditorial() backfills any
# prediction_updates emitted as a terse {id, status} delta with the
# text/resolution_date from memory.json (the 2026-05-27 abort, where 43/43
# updates lacked those required fields), and coerces any out-of-enum status to
# "unverifiable". Logic + unit tests live in src/lib/repair-editorial.js.
node --input-type=module -e "
  import { readFile, writeFile } from 'node:fs/promises';
  import { repairEditorial } from './src/lib/repair-editorial.js';
  const doc = JSON.parse(await readFile('$EDITORIAL_FILE', 'utf8'));
  let memory = {};
  try { memory = JSON.parse(await readFile('data/memory.json', 'utf8')); } catch {}
  const r = repairEditorial(doc, memory);
  if (r.backfilled || r.statusCoerced || r.dropped) {
    await writeFile('$EDITORIAL_FILE', JSON.stringify(doc, null, 2));
    console.error('[synthesize.sh] repaired editorial: backfilled=' + r.backfilled + ' statusCoerced=' + r.statusCoerced + ' dropped=' + r.dropped);
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

# Bound memory growth: (a) expire overdue, never-scored pending predictions to
# unverifiable, (b) drop resolved predictions whose resolution_date passed more
# than HOT_DAYS ago. The synthesizer has never resolved a prediction, so without
# (a) the list — and the prediction_updates echo built from it — grows without
# limit (the unbounded list caused the 2026-05-27 synthesis abort). Hygiene
# only — never fail the run over it.
node --input-type=module -e "
  import { readFile, writeFile } from 'node:fs/promises';
  import { pruneMemory } from './src/lib/prune-memory.js';
  try {
    const doc = JSON.parse(await readFile('data/memory.json', 'utf8'));
    const retainDays = Number(process.env.HOT_DAYS) || 60;
    const graceDays = Number(process.env.PREDICTION_GRACE_DAYS) || 30;
    const s = pruneMemory(doc, { retainDays, graceDays });
    if (s.prunedPredictions > 0 || s.expiredPending > 0) {
      await writeFile('data/memory.json', JSON.stringify(doc, null, 2));
      console.error('[synthesize.sh] pruned memory: expired ' + s.expiredPending + ' overdue pending; removed ' + s.prunedPredictions + ' resolved >' + retainDays + 'd past; ' + s.keptPredictions + ' kept');
    }
  } catch (e) {
    console.error('[synthesize.sh] memory prune skipped: ' + e.message);
  }
"

echo "[synthesize.sh] done. editorial: $EDITORIAL_FILE"
exit 0
