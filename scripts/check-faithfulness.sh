#!/usr/bin/env bash
# Stage 3.5: Faithfulness guard. Runs AFTER editorial validates, BEFORE merge.
# Two never-abort layers: (1) deterministic temporal check (no LLM),
# (2) Sonnet judge for named-author attribution claims only. Detected issues are
# soft-repaired in place + recorded in editorial.faithfulness. ALWAYS exits 0;
# the caller invokes it as `... || true` as a second belt.
#
# Env:
#   FAITHFULNESS_MODEL                    judge model (default: claude-sonnet-4-6)
#   FAITHFULNESS_TEMPORAL_TOLERANCE_DAYS  same-day tolerance (default: 1)
#   STAGING_DIR / CURATED_DIR             paths (match synthesize.sh defaults)

set -uo pipefail

MODEL="${FAITHFULNESS_MODEL:-claude-sonnet-4-6}"
TOL="${FAITHFULNESS_TEMPORAL_TOLERANCE_DAYS:-1}"
FALLBACK_MODEL="${FAITHFULNESS_FALLBACK_MODEL:-sonnet}"
# Lean-context flags: see curate.sh (--bare drops auth in our env). The judge
# needs no tools, so --strict-mcp-config is purely belt-and-braces here.
LEAN_FLAGS=(--strict-mcp-config --mcp-config '{"mcpServers":{}}')
STAGING_DIR="${STAGING_DIR:-data/staging}"
CURATED_DIR="${CURATED_DIR:-${STAGING_DIR}/curated}"
EDITORIAL_FILE="${STAGING_DIR}/editorial.json"
LOG_DIR="$CURATED_DIR/.logs"
mkdir -p "$LOG_DIR"
# Same timezone source as the rest of the pipeline (run.sh / merge-report.sh),
# so the temporal reference date matches the report being checked.
TODAY="$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%F)"

CLAIMS_FILE="$LOG_DIR/faithfulness.claims.json"
PROMPT_FILE="$LOG_DIR/faithfulness.prompt.txt"
VERDICTS_FILE="$LOG_DIR/faithfulness.verdicts.json"

if [ ! -f "$EDITORIAL_FILE" ]; then
  echo "[check-faithfulness.sh] no editorial.json — skipping" >&2
  exit 0
fi

# 1. Detect: temporal flags (kept for the apply step) + attribution claims + judge prompt.
FAITH_EDITORIAL_FILE="$EDITORIAL_FILE" FAITH_CURATED_DIR="$CURATED_DIR" \
FAITH_STAGING_DIR="$STAGING_DIR" FAITH_CLAIMS_FILE="$CLAIMS_FILE" \
FAITH_PROMPT_FILE="$PROMPT_FILE" FAITH_TODAY="$TODAY" FAITH_TOL="$TOL" \
node --input-type=module -e '
  import { readFile, writeFile, readdir } from "node:fs/promises";
  import { buildCuratedIndex, detectTemporalFlags, detectAttributionClaims, buildJudgePrompt } from "./src/lib/faithfulness.js";
  const { FAITH_EDITORIAL_FILE, FAITH_CURATED_DIR, FAITH_STAGING_DIR, FAITH_CLAIMS_FILE, FAITH_PROMPT_FILE, FAITH_TODAY, FAITH_TOL } = process.env;
  const editorial = JSON.parse(await readFile(FAITH_EDITORIAL_FILE, "utf8"));
  const curated = {};
  for (const f of await readdir(FAITH_CURATED_DIR)) {
    if (f.endsWith(".json")) {
      const sec = f.replace(/\.json$/, "");
      try { curated[sec] = JSON.parse(await readFile(FAITH_CURATED_DIR + "/" + f, "utf8")); } catch {}
    }
  }
  let sidecar = {};
  try { sidecar = JSON.parse(await readFile(FAITH_STAGING_DIR + "/source-dates.json", "utf8")); } catch {}
  const index = buildCuratedIndex(curated);
  const temporalFlags = detectTemporalFlags(editorial, index, { reportDate: FAITH_TODAY, toleranceDays: Number(FAITH_TOL), sidecar });
  const claims = detectAttributionClaims(editorial, index, { sidecar });
  await writeFile(FAITH_CLAIMS_FILE, JSON.stringify({ temporalFlags, claims }, null, 2));
  if (claims.length > 0) {
    await writeFile(FAITH_PROMPT_FILE, buildJudgePrompt(claims, FAITH_TODAY));
  }
  console.error("[check-faithfulness.sh] detected temporal=" + temporalFlags.length + " attribution=" + claims.length);
' || { echo '[check-faithfulness.sh] detection failed — skipping (never-abort)' >&2; exit 0; }

# 2. Judge (only if there are attribution claims).
RAN_JUDGE=false
if [ -f "$PROMPT_FILE" ]; then
  RAN_JUDGE=true
  (
    claude -p --model "$MODEL" \
      --fallback-model "$FALLBACK_MODEL" \
      --output-format json \
      --tools "" \
      --allowed-tools "" \
      --no-session-persistence \
      "${LEAN_FLAGS[@]}" \
      < "$PROMPT_FILE" > "$VERDICTS_FILE.raw" 2> "$LOG_DIR/faithfulness.err.txt"
  ) &
  CLAUDE_PID=$!
  bash scripts/watchdog.sh "$CLAUDE_PID" > "$LOG_DIR/faithfulness.watchdog.log" 2>&1 &
  WATCHDOG_PID=$!
  wait "$CLAUDE_PID"; RC=$?
  kill "$WATCHDOG_PID" 2>/dev/null || true
  node src/lib/claude-envelope.js sidecar "$VERDICTS_FILE.raw" "$LOG_DIR/faithfulness.meta.json" "faithfulness" 2>/dev/null || true
  if [ "$RC" -ne 0 ]; then
    echo "[check-faithfulness.sh] judge claude -p failed rc=$RC — applying temporal-only repairs (never-abort)" >&2
    RAN_JUDGE=false
    : > "$VERDICTS_FILE.raw"
  fi
fi

# 3. Apply repairs + write editorial.json back + emit audit summary.
FAITH_EDITORIAL_FILE="$EDITORIAL_FILE" FAITH_CLAIMS_FILE="$CLAIMS_FILE" \
FAITH_VERDICTS_RAW="$VERDICTS_FILE.raw" FAITH_TODAY="$TODAY" \
FAITH_MODEL="$MODEL" FAITH_RAN_JUDGE="$RAN_JUDGE" \
node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";
  import { parseJudgeVerdicts, applyRepairs } from "./src/lib/faithfulness.js";
  const { FAITH_EDITORIAL_FILE, FAITH_CLAIMS_FILE, FAITH_VERDICTS_RAW, FAITH_TODAY, FAITH_MODEL } = process.env;
  const RAN_JUDGE = process.env.FAITH_RAN_JUDGE === "true";
  const editorial = JSON.parse(await readFile(FAITH_EDITORIAL_FILE, "utf8"));
  const { temporalFlags, claims } = JSON.parse(await readFile(FAITH_CLAIMS_FILE, "utf8"));
  let attributionVerdicts = [];
  if (RAN_JUDGE) {
    let verdictText = "";
    try {
      const env = JSON.parse(await readFile(FAITH_VERDICTS_RAW, "utf8"));
      verdictText = typeof env.result === "string" ? env.result : "";
    } catch {}
    attributionVerdicts = parseJudgeVerdicts(verdictText, claims);
  }
  const { audit } = applyRepairs(editorial, { temporalFlags, attributionVerdicts }, { reportDate: FAITH_TODAY, model: FAITH_MODEL, ranJudge: RAN_JUDGE });
  await writeFile(FAITH_EDITORIAL_FILE, JSON.stringify(editorial, null, 2));
  console.error("[check-faithfulness.sh] flagged=" + audit.flagged.length + " repaired=" + audit.repaired + " ran_judge=" + audit.ran_judge);
' || { echo '[check-faithfulness.sh] apply failed — leaving editorial unchanged (never-abort)' >&2; exit 0; }

exit 0
