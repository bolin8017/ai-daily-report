#!/usr/bin/env bash
# Phase 3 archive job — packages reports older than HOT_DAYS into monthly
# tarballs and uploads to GitHub Releases as archive-YYYY-MM tags.
# After successful upload, removes the archived reports from data branch.
#
# Designed to be idempotent: if archive-YYYY-MM Release already exists,
# skip that month. Re-running on the same day is safe.
#
# Usage:
#   bash scripts/archive-month.sh                  # archive based on today's date
#   bash scripts/archive-month.sh --dry-run        # show what would happen
#   bash scripts/archive-month.sh --ref YYYY-MM-DD # use this as "today" (testing)
#
# Env:
#   HOT_DAYS=60       # reports newer than this stay on data branch
#   ACTIVE_THEME=ai-builder
#   GITHUB_TOKEN      # required for `gh release` upload + `git push`
#
# Exits:
#   0 success (incl. nothing to do)
#   1 missing dependency / env
#   2 partial failure (some months uploaded, others not)

set -uo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=0
REF_DATE="$(TZ=Asia/Taipei date +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --ref) REF_DATE="$2"; shift 2 ;;
    *) echo "[archive-month] unknown arg: $1" >&2; exit 1 ;;
  esac
done

HOT_DAYS="${HOT_DAYS:-60}"
ACTIVE_THEME="${ACTIVE_THEME:-ai-builder}"

if ! command -v gh >/dev/null 2>&1; then
  echo "[archive-month] FATAL: gh CLI not installed" >&2
  exit 1
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[archive-month] FATAL: GITHUB_TOKEN unset" >&2
  exit 1
fi

# Compute cutoff date (REF_DATE - HOT_DAYS).
CUTOFF=$(date -d "$REF_DATE - $HOT_DAYS days" +%F)
echo "[archive-month] ref=$REF_DATE cutoff=$CUTOFF (HOT_DAYS=$HOT_DAYS)"

# Identify reports older than cutoff, grouped by YYYY-MM.
REPORTS_DIR="data/reports"
if [ ! -d "$REPORTS_DIR" ]; then
  echo "[archive-month] no data/reports/ directory — nothing to archive"
  exit 0
fi

# Sort by date, filter older than cutoff, group by month.
ARCHIVABLE=$(
  find "$REPORTS_DIR" -maxdepth 1 -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].json' -type f \
    | sed "s|$REPORTS_DIR/||" \
    | sort \
    | awk -v c="$CUTOFF.json" '$1 < c'
)

if [ -z "$ARCHIVABLE" ]; then
  echo "[archive-month] no reports older than $CUTOFF — nothing to do"
  exit 0
fi

# Group archivable reports by YYYY-MM.
MONTHS=$(echo "$ARCHIVABLE" | sed 's|\(....-..\)-..\.json|\1|' | sort -u)
echo "[archive-month] candidate months:"
echo "$MONTHS" | sed 's/^/  /'

WORK_DIR=$(mktemp -d -t archive-month.XXXXXX)
trap "rm -rf '$WORK_DIR'" EXIT

PARTIAL_FAILURES=0
SUCCESSFUL_MONTHS=()

for ym in $MONTHS; do
  TAG="archive-${ym}"
  TARBALL="${WORK_DIR}/reports-${ym}.tar.gz"
  CHECKSUM="${WORK_DIR}/reports-${ym}.sha256"

  # Skip if Release already exists.
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "[archive-month] $TAG already exists on Releases — skipping"
    continue
  fi

  # Build tarball of reports in this month
  MONTH_FILES=$(echo "$ARCHIVABLE" | grep "^${ym}-")
  if [ -z "$MONTH_FILES" ]; then continue; fi

  (cd "$REPORTS_DIR" && tar -czf "$TARBALL" $MONTH_FILES)
  (cd "$WORK_DIR" && sha256sum "reports-${ym}.tar.gz" > "reports-${ym}.sha256")
  echo "[archive-month] built $TARBALL ($(wc -c < "$TARBALL") bytes)"

  if [ "$DRY_RUN" = "1" ]; then
    echo "[archive-month] DRY-RUN: would create release $TAG with assets:"
    echo "  $TARBALL"
    echo "  $CHECKSUM"
    continue
  fi

  # Create the Release with notes + attach assets.
  NOTES=$(cat <<EOF
Monthly archive of daily reports for ${ym}.

Contents: $(echo "$MONTH_FILES" | wc -l) report JSON files.

Theme: ${ACTIVE_THEME}

These reports were active on the \`data\` branch through ${CUTOFF}; this
release is the canonical cold-storage location going forward. The CI
build step hydrates the last HYDRATE_MONTHS months back into
\`data/reports/\` so the static site continues to serve them.

Integrity: sha256 attached as \`reports-${ym}.sha256\`.
EOF
)

  if ! gh release create "$TAG" "$TARBALL" "$CHECKSUM" \
      --title "Archive ${ym} (${ACTIVE_THEME})" \
      --notes "$NOTES"; then
    echo "[archive-month] FAILED to create $TAG — leaving reports on data branch" >&2
    PARTIAL_FAILURES=$((PARTIAL_FAILURES + 1))
    continue
  fi

  echo "[archive-month] $TAG uploaded"
  SUCCESSFUL_MONTHS+=("$ym")
done

# Now remove the archived reports from data branch. Done as a single commit
# so the git history says "archived 2026-01 through 2026-03" rather than 3
# separate destructive commits.
if [ "${#SUCCESSFUL_MONTHS[@]}" -eq 0 ]; then
  if [ "$PARTIAL_FAILURES" -gt 0 ]; then
    echo "[archive-month] no successful uploads, $PARTIAL_FAILURES failure(s)" >&2
    exit 2
  fi
  echo "[archive-month] nothing newly archived"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[archive-month] DRY-RUN complete (would have removed ${#SUCCESSFUL_MONTHS[@]} months from data branch)"
  exit 0
fi

# Use src/lib/commit.js plumbing to remove from data branch without
# touching main's working tree. Pass the list of paths to remove as the
# args; commit.js handles git plumbing.
REMOVE_PATHS=()
for ym in "${SUCCESSFUL_MONTHS[@]}"; do
  MONTH_FILES=$(echo "$ARCHIVABLE" | grep "^${ym}-")
  for f in $MONTH_FILES; do
    REMOVE_PATHS+=("data/reports/$f")
  done
done

MSG="archive: move $(echo "${SUCCESSFUL_MONTHS[@]}" | tr ' ' ',') reports to Releases (HOT_DAYS=${HOT_DAYS})"

# Call commit.js in "remove" mode. (Phase 3 enhancement: add --remove flag
# to commit.js so it can delete paths from data branch via plumbing.)
node src/lib/commit.js "$REF_DATE" "$MSG" --remove "${REMOVE_PATHS[@]}"
RC=$?

if [ "$RC" -ne 0 ]; then
  echo "[archive-month] FAILED to remove from data branch (rc=$RC). Releases were uploaded; rerun to clean up data branch." >&2
  exit 2
fi

echo "[archive-month] done: archived ${#SUCCESSFUL_MONTHS[@]} months, removed $(echo "${REMOVE_PATHS[@]}" | wc -w) reports from data branch"

if [ "$PARTIAL_FAILURES" -gt 0 ]; then
  echo "[archive-month] $PARTIAL_FAILURES month(s) failed to upload — rerun to retry" >&2
  exit 2
fi

exit 0
