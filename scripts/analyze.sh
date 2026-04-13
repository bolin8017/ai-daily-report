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
  --allowedTools Read Write Bash Grep Glob \
  < "$PROMPT_FILE" || CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  echo "[analyze] FATAL: claude -p exited with code ${CLAUDE_EXIT}" >&2
  exit "$CLAUDE_EXIT"
fi

echo "[analyze] $(date -Iseconds) — claude session complete"

# ── Validate output ───────────────────────────────────────────────

REPORT_FILE="data/reports/${DATE}.json"

if [ ! -f "$REPORT_FILE" ]; then
  echo "[analyze] FATAL: ${REPORT_FILE} not created by agent" >&2
  exit 1
fi

echo "[analyze] validating report..."
node src/lib/validate.js report "$REPORT_FILE"

echo "[analyze] validating memory..."
node src/lib/validate.js memory data/memory.json

# ── Commit + push ─────────────────────────────────────────────────

echo "[analyze] committing..."
git add "$REPORT_FILE" data/memory.json

if git diff --cached --quiet; then
  echo "[analyze] no changes to commit"
  echo "[analyze] $(date -Iseconds) — done"
  exit 0
fi

git commit -m "report: ${DATE} daily creative brief"

if [ "$SKIP_PUSH" = "1" ]; then
  echo "[analyze] SKIP_PUSH — committed locally, skipping push"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  # Use git remote URL (already set to authenticated URL by docker-entrypoint.sh)
  # to avoid exposing GITHUB_TOKEN in process args
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/bolin8017/ai-daily-report.git"
  git push origin HEAD:main || { git remote set-url origin "https://github.com/bolin8017/ai-daily-report.git"; exit 1; }
  # Scrub auth token from persisted git config
  git remote set-url origin "https://github.com/bolin8017/ai-daily-report.git"
  echo "[analyze] pushed $(git rev-parse --short HEAD) to origin/main"
else
  echo "[analyze] GITHUB_TOKEN not set — committed locally, skipping push"
fi

echo "[analyze] $(date -Iseconds) — done"
