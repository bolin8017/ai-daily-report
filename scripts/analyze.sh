#!/usr/bin/env bash
# Stage 2: Analysis. Invokes Claude Code to produce daily reports per lens.
#
# Reads condensed data from data/staging/ (committed by Stage 1), and for
# each enabled lens in config.json → lenses[], assembles the lens-specific
# agent prompt + shared quality rules, invokes claude -p, validates output,
# and commits.
#
# Critical lenses (e.g., ai-builder) abort the deploy on failure; non-critical
# lenses (e.g., phison-aidaptiv) log degraded and continue.
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
MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"
SKIP_PUSH="${SKIP_PUSH:-0}"

# ── Pipeline routing ──────────────────────────────────────────────
# FEATURE_NEW_PIPELINE=1 (default after IA redesign): run new
# Stage 2 curate + Stage 3 synthesize, output v2.0 unified report.
# FEATURE_NEW_PIPELINE=0: fall through to legacy lens-based pipeline
# below — preserved as rollback path until new pipeline is proven in
# production. Toggle via ~/.ai-daily-report.env on the VM.
FEATURE_NEW_PIPELINE="${FEATURE_NEW_PIPELINE:-1}"

if [ "$FEATURE_NEW_PIPELINE" = "1" ]; then
  echo "[analyze] $(date -Iseconds) — new pipeline: curate → synthesize (date=${DATE})"

  if ! bash scripts/curate.sh; then
    echo "[analyze] FATAL: curate failed — aborting" >&2
    exit 1
  fi

  if ! bash scripts/synthesize.sh; then
    echo "[analyze] FATAL: synthesize failed — aborting" >&2
    exit 1
  fi

  # Phase 2 (FEATURE_MERGE_STEP=1) — synthesize wrote editorial.json only.
  # Compose final report.json mechanically from editorial + curated/*.json.
  if [ "${FEATURE_MERGE_STEP:-0}" = "1" ]; then
    echo "[analyze] FEATURE_MERGE_STEP=1 — composing report from editorial + curated"
    if ! bash scripts/merge-report.sh "$DATE"; then
      echo "[analyze] FATAL: merge-report failed — aborting" >&2
      exit 1
    fi
  fi

  REPORT_FILE="data/reports/${DATE}.json"

  if [ "$SKIP_PUSH" = "1" ]; then
    echo "[analyze] SKIP_PUSH — skipping commit and push"
  else
    COMMIT_PATHS=()
    [ -f "$REPORT_FILE" ] && COMMIT_PATHS+=("$REPORT_FILE")
    [ -f "data/memory.json" ] && COMMIT_PATHS+=("data/memory.json")
    if [ "${#COMMIT_PATHS[@]}" -eq 0 ]; then
      echo "[analyze] no outputs to commit — exiting nonzero" >&2
      exit 1
    fi
    echo "[analyze] committing ${#COMMIT_PATHS[@]} files to data branch..."
    node src/lib/commit.js "$DATE" "report: ${DATE} daily creative brief" "${COMMIT_PATHS[@]}"
  fi

  echo "[analyze] $(date -Iseconds) — done (new pipeline)"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────
# Legacy pipeline (FEATURE_NEW_PIPELINE=0). Preserved for rollback.
# ─────────────────────────────────────────────────────────────────

# ── Preflight checks ──────────────────────────────────────────────

for f in data/staging/metadata.json .claude/daily-report-quality.md; do
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

# ── Build lens execution order ────────────────────────────────────
# Critical lenses run first so their failure aborts immediately;
# non-critical lenses run after and degrade gracefully on failure.
LENSES=$(node -e '
  const config = JSON.parse(require("fs").readFileSync("config.json","utf8"));
  const sorted = (config.lenses || [])
    .filter(l => l.enabled !== false)
    .sort((a, b) => (b.critical === true) - (a.critical === true));
  console.log(sorted.map(l => l.id).join("\n"));
')

if [ -z "$LENSES" ]; then
  echo "[analyze] FATAL: no enabled lenses in config.json" >&2
  exit 1
fi

echo "[analyze] $(date -Iseconds) — starting analysis for ${DATE} (model: ${MODEL})"
echo "[analyze] enabled lenses: $(echo "$LENSES" | tr '\n' ' ')"

# Files to include in the final commit (per-lens report + memory pairs).
COMMIT_PATHS=()

# ── Per-lens loop ─────────────────────────────────────────────────

for lens_id in $LENSES; do
  echo "[analyze] $(date -Iseconds) — starting lens: ${lens_id}"

  LENS_PROMPT_FILE=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('config.json','utf8'));
    const l = c.lenses.find(x => x.id === '${lens_id}');
    console.log(l.prompt_file);
  ")
  LENS_CRITICAL=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('config.json','utf8'));
    const l = c.lenses.find(x => x.id === '${lens_id}');
    console.log(l.critical === true ? 'true' : 'false');
  ")
  LENS_REPORT_PATH=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('config.json','utf8'));
    const l = c.lenses.find(x => x.id === '${lens_id}');
    const tpl = l.output_paths.report;
    console.log(tpl.replace(/{id}/g, '${lens_id}').replace(/{date}/g, '${DATE}'));
  ")
  LENS_MEMORY_PATH=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('config.json','utf8'));
    const l = c.lenses.find(x => x.id === '${lens_id}');
    const tpl = l.output_paths.memory;
    console.log(tpl.replace(/{id}/g, '${lens_id}'));
  ")

  if [ ! -f "$LENS_PROMPT_FILE" ]; then
    echo "[analyze] FATAL: lens prompt file missing: ${LENS_PROMPT_FILE}" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$LENS_REPORT_PATH")" "$(dirname "$LENS_MEMORY_PATH")"

  PROMPT_FILE=$(mktemp "/tmp/analyze-prompt-${lens_id}-XXXXXX.txt")
  CLAUDE_STDERR=$(mktemp "/tmp/analyze-claude-stderr-${lens_id}-XXXXXX.log")

  # Build per-lens prompt
  {
    cat "$LENS_PROMPT_FILE"
    printf '\n---\n\n## Quality rules (must not violate)\n\n'
    cat .claude/daily-report-quality.md
    printf '\n---\n\n## Today'\''s date: %s\n' "$DATE"
    printf '\n## Output paths for this lens\n\n'
    printf -- '- Report: `%s`\n' "$LENS_REPORT_PATH"
    printf -- '- Memory: `%s`\n' "$LENS_MEMORY_PATH"
    printf '\nExecute the workflow above. Read input files, analyze the data, and write to the paths above.\n'
  } > "$PROMPT_FILE"

  # ── Invoke Claude ───────────────────────────────────────────────
  # Watchdog tracks /proc/$PID/io + CPU ticks instead of using a wall-clock
  # timeout — LLM pipeline runtime varies too much for a fixed cap to be safe.

  LENS_STARTED_MS=$(node -p "Date.now()")

  : > "$CLAUDE_STDERR"
  claude -p \
    --output-format text \
    --model "$MODEL" \
    --allowedTools Read Write Grep Glob \
    < "$PROMPT_FILE" 2> "$CLAUDE_STDERR" &
  CLAUDE_PID=$!

  tail -F --pid="$CLAUDE_PID" -n +1 "$CLAUDE_STDERR" >&2 &
  TAIL_PID=$!

  bash "$(dirname "$0")/watchdog.sh" "$CLAUDE_PID" &
  WATCHDOG_PID=$!

  CLAUDE_EXIT=0
  wait "$CLAUDE_PID" || CLAUDE_EXIT=$?

  kill "$WATCHDOG_PID" 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
  wait "$TAIL_PID" 2>/dev/null || true

  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "═══════════════════════════════════════════════════════════════" >&2
    case "$CLAUDE_EXIT" in
      143) echo "[analyze] lens=${lens_id} claude -p killed by SIGTERM (exit 143) — likely watchdog liveness failure" >&2 ;;
      137) echo "[analyze] lens=${lens_id} claude -p killed by SIGKILL (exit 137) — OOM or watchdog escalation" >&2 ;;
      *)   echo "[analyze] lens=${lens_id} claude -p exited with code ${CLAUDE_EXIT}" >&2 ;;
    esac
    echo "[analyze] stderr tail (last 50 lines):" >&2
    echo "───────────────────────────────────────────────────────────────" >&2
    tail -n 50 "$CLAUDE_STDERR" >&2 || true
    echo "═══════════════════════════════════════════════════════════════" >&2

    rm -f "$PROMPT_FILE" "$CLAUDE_STDERR"

    if [ "$LENS_CRITICAL" = "true" ]; then
      echo "[analyze] FATAL: critical lens ${lens_id} failed — aborting deploy" >&2
      exit "$CLAUDE_EXIT"
    else
      echo "[analyze] non-critical lens ${lens_id} failed (exit ${CLAUDE_EXIT}) — degraded, continuing" >&2
      rm -f "$LENS_REPORT_PATH"
      continue
    fi
  fi

  LENS_FINISHED_MS=$(node -p "Date.now()")
  LENS_DURATION_MS=$((LENS_FINISHED_MS - LENS_STARTED_MS))
  echo "[analyze] lens=${lens_id} claude session complete (${LENS_DURATION_MS}ms)"

  rm -f "$PROMPT_FILE" "$CLAUDE_STDERR"

  # ── Validate output exists ──────────────────────────────────────

  if [ ! -f "$LENS_REPORT_PATH" ]; then
    if [ "$LENS_CRITICAL" = "true" ]; then
      echo "[analyze] FATAL: ${LENS_REPORT_PATH} not created by agent (critical lens)" >&2
      exit 1
    else
      echo "[analyze] non-critical lens ${lens_id} did not write report — degraded" >&2
      continue
    fi
  fi

  # ── Meta injection (ai-builder only — ReportSchema requires it) ─

  if [ "$lens_id" = "ai-builder" ]; then
    echo "[analyze] injecting meta block for ${lens_id}..."
    ANALYZE_DURATION_MS="$LENS_DURATION_MS" \
    MODEL="$MODEL" \
    REPORT_FILE="$LENS_REPORT_PATH" \
    node -e '
      const fs = require("node:fs");
      const staging = JSON.parse(fs.readFileSync("data/staging/metadata.json", "utf8"));
      const reportPath = process.env.REPORT_FILE;
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      if (!staging.run_id || !staging.pipeline_version) {
        console.error("[analyze] staging lacks run_id/pipeline_version — skipping meta injection");
        process.exit(0);
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
  fi

  # ── Validate report + memory ────────────────────────────────────

  echo "[analyze] validating ${lens_id} report..."
  if [ "$lens_id" = "ai-builder" ]; then
    if ! node src/lib/validate.js report "$LENS_REPORT_PATH"; then
      if [ "$LENS_CRITICAL" = "true" ]; then
        echo "[analyze] FATAL: critical lens ${lens_id} report failed validation" >&2
        exit 1
      else
        echo "[analyze] non-critical lens ${lens_id} report validation failed — degraded" >&2
        rm -f "$LENS_REPORT_PATH"
        continue
      fi
    fi
    if [ -f "$LENS_MEMORY_PATH" ]; then
      node src/lib/validate.js memory "$LENS_MEMORY_PATH"
    fi
  else
    if ! node src/lib/validate-lens-report.js "$LENS_REPORT_PATH" "$lens_id"; then
      if [ "$LENS_CRITICAL" = "true" ]; then
        echo "[analyze] FATAL: critical lens ${lens_id} report failed validation" >&2
        exit 1
      else
        echo "[analyze] non-critical lens ${lens_id} report validation failed — degraded" >&2
        rm -f "$LENS_REPORT_PATH"
        continue
      fi
    fi
  fi

  # Mark for commit
  [ -f "$LENS_REPORT_PATH" ] && COMMIT_PATHS+=("$LENS_REPORT_PATH")
  [ -f "$LENS_MEMORY_PATH" ] && COMMIT_PATHS+=("$LENS_MEMORY_PATH")

done

# ── Commit + push to data branch ──────────────────────────────────
# src/lib/commit.js builds the commit with git plumbing so main's
# working tree and index are never touched. Bot artifacts live on
# the `data` orphan branch.

if [ "$SKIP_PUSH" = "1" ]; then
  echo "[analyze] SKIP_PUSH — skipping commit and push"
else
  if [ "${#COMMIT_PATHS[@]}" -eq 0 ]; then
    echo "[analyze] no successful lens outputs — skipping commit" >&2
    exit 1
  fi
  echo "[analyze] committing ${#COMMIT_PATHS[@]} files to data branch..."
  node src/lib/commit.js "$DATE" "report: ${DATE} daily creative brief" "${COMMIT_PATHS[@]}"
fi

echo "[analyze] $(date -Iseconds) — done"
