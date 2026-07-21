#!/usr/bin/env bash
# Stage 2: Curate — 4 parallel claude -p subprocesses, one per section.
# Each gets its own watchdog. Output validated against per-section schema.
#
# Usage: scripts/curate.sh [section ...]   # no args = all four; e.g. `market` re-runs one
# Env:
#   CURATE_MODEL — model (default: claude-haiku-4-5)
#   STAGING_DIR  — input dir (default: data/staging)
#   CURATED_DIR  — output dir (default: data/staging/curated)
#
# Exit codes:
#   0  — all critical (discoveries, pulse) succeeded
#   1  — a critical section failed (abort pipeline)
#   2  — unknown section argument

set -uo pipefail

MODEL="${CURATE_MODEL:-claude-haiku-4-5}"
STAGING_DIR="${STAGING_DIR:-data/staging}"
CURATED_DIR="${CURATED_DIR:-${STAGING_DIR}/curated}"
FALLBACK_MODEL="${CURATE_FALLBACK_MODEL:-sonnet}"
# Lean-context flags: strip the per-call MCP-discovery tax (curators need no MCP
# servers). NB: --bare also strips it but DROPS AUTH in our env (probe 2026-06-02
# returned "Not logged in"), so use --strict-mcp-config, which keeps auth + tools.
LEAN_FLAGS=(--strict-mcp-config --mcp-config '{"mcpServers":{}}')

mkdir -p "$CURATED_DIR"
LOG_DIR="$CURATED_DIR/.logs"
mkdir -p "$LOG_DIR"

# ops-5 (2026-07-21 review): failure evidence lives at fixed per-section paths
# and is overwritten by the next run — the 2026-07-08→12 malformed outputs were
# gone before anyone could diagnose them. On failure (or a zero-item output),
# copy the prompt/raw/output/error artifacts into a dated quarantine dir first.
# A same-day re-run overwrites that day's copies, keeping the latest attempt.
QUARANTINE_ROOT="$LOG_DIR/failures"
find "$QUARANTINE_ROOT" -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

quarantine_artifacts() {
  local section="$1" reason="$2"
  local qdir
  qdir="$QUARANTINE_ROOT/$(TZ="${REPORT_TIMEZONE:-Asia/Taipei}" date +%F)"
  mkdir -p "$qdir"
  local f
  for f in \
    "$LOG_DIR/$section.prompt.txt" \
    "$LOG_DIR/$section.raw.json" \
    "$LOG_DIR/$section.err.txt" \
    "$LOG_DIR/$section.err.txt.validate" \
    "$LOG_DIR/$section.err.txt.repair" \
    "$LOG_DIR/$section.repair-prompt.txt" \
    "$LOG_DIR/$section.repair-raw.json" \
    "$CURATED_DIR/$section.json"; do
    if [ -f "$f" ]; then cp -f "$f" "$qdir/" 2>/dev/null || true; fi
  done
  echo "[curate.sh] $section artifacts quarantined to $qdir ($reason)"
}

ALL_SECTIONS=(discoveries pulse market tech)
CRITICAL=(discoveries pulse)

# Optional positional args restrict the run to specific sections, e.g.
#   bash scripts/curate.sh market        # re-run only the market curator
# No args = run all four (production default; unchanged behavior).
SECTIONS=("${ALL_SECTIONS[@]}")
if [ "$#" -gt 0 ]; then
  SECTIONS=()
  for arg in "$@"; do
    case " ${ALL_SECTIONS[*]} " in
      *" ${arg} "*) SECTIONS+=("${arg}") ;;
      *) echo "[curate.sh] unknown section: ${arg} (valid: ${ALL_SECTIONS[*]})" >&2; exit 2 ;;
    esac
  done
fi

run_curator() {
  local section="$1"
  local prompt_file="$LOG_DIR/$section.prompt.txt"
  local raw_file="$LOG_DIR/$section.raw.json"
  local err_file="$LOG_DIR/$section.err.txt"
  local out_file="$CURATED_DIR/$section.json"

  echo "[curate.sh] starting $section (model=$MODEL)"

  # Assemble the curator prompt and append an explicit "Execute now"
  # imperative at the end. Without the imperative Haiku ack-chats; with it,
  # the model treats the prompt as an immediate task. Mirrors the pattern
  # used by the legacy lens prompts.
  # Prompt generation must fail loudly: the block's exit status used to be the
  # trailing printf, so a throwing getPrompt() produced a contentless prompt
  # and burned a full claude -p call that surfaced later as a misleading
  # VALIDATION FAILED.
  if ! node -e "
      import('./src/curators/${section}.js').then(m => m.getPrompt()).then(p => process.stdout.write(p));
    " > "$prompt_file" 2> "$err_file.prompt"; then
    echo "[curate.sh] $section FAILED (prompt generation):" >&2
    cat "$err_file.prompt" >&2
    return 1
  fi
  {
    printf '\n\n---\n\n## Execute now\n\n'
    printf 'Use the Read tool on the staging files listed above, apply the include/exclude rules per sub-group, and use the Write tool to write strict JSON matching the schema to `data/staging/curated/%s.json`.\n\n' "$section"
    printf 'Do not output prose, acknowledgement, or explanation. Do not ask questions. Begin with Read calls immediately. The final action is one Write call.\n'
  } >> "$prompt_file"

  (
    claude -p \
      --model "$MODEL" \
      --fallback-model "$FALLBACK_MODEL" \
      --output-format json \
      --tools "Read,Write,Glob,Grep" \
      --allowed-tools Read Write Glob Grep \
      --no-session-persistence \
      "${LEAN_FLAGS[@]}" \
      < "$prompt_file" \
      > "$raw_file" \
      2> "$err_file"
  ) &
  local claude_pid=$!

  bash scripts/watchdog.sh "$claude_pid" > "$LOG_DIR/$section.watchdog.log" 2>&1 &
  local watchdog_pid=$!

  wait "$claude_pid"
  local claude_rc=$?

  kill "$watchdog_pid" 2>/dev/null || true

  # Observability: extract this stage's cost/usage from the json envelope.
  node src/lib/claude-envelope.js sidecar "$raw_file" "$LOG_DIR/$section.meta.json" "curate.$section" 2>/dev/null || true

  if [ "$claude_rc" -ne 0 ]; then
    echo "[curate.sh] $section FAILED (claude rc=$claude_rc)"
    cat "$err_file" >&2
    quarantine_artifacts "$section" "claude rc=$claude_rc"
    return 1
  fi

  # The curator writes $out_file directly via the Write tool. If it didn't,
  # recover the model's final text from the json envelope's .result field
  # (stdout is now the envelope, not bare JSON).
  if [ ! -f "$out_file" ]; then
    node src/lib/claude-envelope.js result "$raw_file" > "$out_file"
  fi

  # Validate — the validator (src/curators/validate-output.js) already
  # attempts a deterministic jsonrepair pass on malformed JSON. If it still
  # fails, one targeted LLM repair: feed the exact validation error back
  # instead of blind-retrying the whole curation — the 2026-07-08→12 outage
  # proved an identical retry fails identically (ops-1, 2026-07-21 review).
  local validate_log
  if validate_log=$(node src/curators/validate-output.js "$section" "$out_file" 2> "$err_file.validate"); then
    echo "$validate_log"
    case "$validate_log" in
      *'items=0'*) quarantine_artifacts "$section" "validated but empty" ;;
    esac
    return 0
  fi
  echo "[curate.sh] $section validation failed — attempting LLM repair (model=$FALLBACK_MODEL)"
  cat "$err_file.validate" >&2
  local repair_prompt="$LOG_DIR/$section.repair-prompt.txt"
  {
    printf 'The file `%s` was written by an automated curator but failed JSON validation with this error:\n\n' "$out_file"
    cat "$err_file.validate"
    printf '\nUse the Read tool to read that file, fix the malformed JSON syntax and/or the schema issues named above while preserving the existing content as faithfully as possible, and use the Write tool to write the corrected strict JSON back to the same path (`%s`).\n\n' "$out_file"
    printf 'Do not output prose, acknowledgement, or explanation. Do not ask questions. Begin with a Read call. The final action is one Write call.\n'
  } > "$repair_prompt"
  (
    claude -p \
      --model "$FALLBACK_MODEL" \
      --output-format json \
      --tools "Read,Write" \
      --allowed-tools Read Write \
      --no-session-persistence \
      "${LEAN_FLAGS[@]}" \
      < "$repair_prompt" \
      > "$LOG_DIR/$section.repair-raw.json" \
      2> "$err_file.repair"
  ) &
  local repair_pid=$!
  bash scripts/watchdog.sh "$repair_pid" > "$LOG_DIR/$section.repair-watchdog.log" 2>&1 &
  local repair_watchdog_pid=$!
  wait "$repair_pid"
  local repair_rc=$?
  kill "$repair_watchdog_pid" 2>/dev/null || true
  node src/lib/claude-envelope.js sidecar "$LOG_DIR/$section.repair-raw.json" "$LOG_DIR/$section.repair.meta.json" "curate.$section.repair" 2>/dev/null || true
  if [ "$repair_rc" -ne 0 ]; then
    echo "[curate.sh] $section repair FAILED (claude rc=$repair_rc)"
    cat "$err_file.repair" >&2
    quarantine_artifacts "$section" "repair claude rc=$repair_rc"
    return 1
  fi
  if ! validate_log=$(node src/curators/validate-output.js "$section" "$out_file"); then
    echo "[curate.sh] $section VALIDATION FAILED"
    quarantine_artifacts "$section" "validation failed after LLM repair"
    return 2
  fi
  echo "$validate_log"
  echo "[curate.sh] $section recovered via LLM repair"
  case "$validate_log" in
    *'items=0'*) quarantine_artifacts "$section" "validated but empty" ;;
  esac
  return 0
}

# Launch all sections in parallel
declare -A PIDS
for sec in "${SECTIONS[@]}"; do
  run_curator "$sec" &
  PIDS[$sec]=$!
done

# Wait + collect rcs
FAILED=()
for sec in "${SECTIONS[@]}"; do
  if ! wait "${PIDS[$sec]}"; then
    FAILED+=("$sec")
  fi
done

# Decide exit code based on critical sections
ABORT=0
for c in "${CRITICAL[@]}"; do
  for f in "${FAILED[@]}"; do
    if [ "$c" = "$f" ]; then
      ABORT=1
      echo "[curate.sh] critical section '$c' failed — aborting"
    fi
  done
done

if [ "$ABORT" -eq 1 ]; then
  exit 1
fi

# Log degraded non-critical
for f in "${FAILED[@]}"; do
  echo "[curate.sh] non-critical section '$f' failed — UI will show degraded"
done

echo "[curate.sh] done. Curated outputs in $CURATED_DIR/"
exit 0
