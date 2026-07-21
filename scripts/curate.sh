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
    return 1
  fi

  # The curator writes $out_file directly via the Write tool. If it didn't,
  # recover the model's final text from the json envelope's .result field
  # (stdout is now the envelope, not bare JSON).
  if [ ! -f "$out_file" ]; then
    node src/lib/claude-envelope.js result "$raw_file" > "$out_file"
  fi

  if ! node -e "
    import('./src/curators/${section}.js').then(async m => {
      const fs = await import('node:fs/promises');
      const raw = JSON.parse(await fs.readFile('$out_file', 'utf8'));
      const parsed = m.validate(raw);
      await fs.writeFile('$out_file', JSON.stringify(parsed, null, 2));
      const total = Object.values(parsed).flat().length;
      console.log('[curate.sh] $section validated, items=' + total);
    }).catch(e => { console.error(e.message); process.exit(2); });
  "; then
    echo "[curate.sh] $section VALIDATION FAILED"
    return 2
  fi

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
