#!/usr/bin/env bash
# Phase 3 archive job — packages reports older than HOT_DAYS into monthly
# tarballs and uploads to GitHub Releases as archive-YYYY-MM tags. After
# successful upload, removes the archived reports from the data branch via
# src/lib/commit.js --remove (which uses git plumbing, never touching main's
# working tree).
#
# Idempotent: if archive-YYYY-MM Release already exists, skip that month.
# Re-running on the same day is safe.
#
# Usage:
#   bash scripts/archive-month.sh                  # archive based on today's date
#   bash scripts/archive-month.sh --dry-run        # show what would happen
#   bash scripts/archive-month.sh --ref YYYY-MM-DD # use this as "today" (testing)
#
# Env:
#   HOT_DAYS=60       # reports newer than this stay on data branch
#   ACTIVE_THEME=ai-builder
#   GITHUB_TOKEN      # required for Releases API + git push
#   GITHUB_REPO       # owner/repo (default: bolin8017/ai-daily-report)
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
GITHUB_REPO="${GITHUB_REPO:-bolin8017/ai-daily-report}"
API_BASE="https://api.github.com/repos/${GITHUB_REPO}"
UPLOADS_BASE="https://uploads.github.com/repos/${GITHUB_REPO}"

if ! command -v curl >/dev/null 2>&1; then
  echo "[archive-month] FATAL: curl not installed" >&2
  exit 1
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[archive-month] FATAL: GITHUB_TOKEN unset" >&2
  exit 1
fi

CUTOFF=$(date -d "$REF_DATE - $HOT_DAYS days" +%F)
echo "[archive-month] ref=$REF_DATE cutoff=$CUTOFF (HOT_DAYS=$HOT_DAYS)"

REPORTS_DIR="data/reports"
if [ ! -d "$REPORTS_DIR" ]; then
  echo "[archive-month] no data/reports/ directory — nothing to archive"
  exit 0
fi

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

MONTHS=$(echo "$ARCHIVABLE" | sed 's|\(....-..\)-..\.json|\1|' | sort -u)
echo "[archive-month] candidate months:"
echo "$MONTHS" | sed 's/^/  /'

WORK_DIR=$(mktemp -d -t archive-month.XXXXXX)
trap "rm -rf '$WORK_DIR'" EXIT

# --- GitHub API helpers (curl-based, no gh CLI needed) ---

# Returns 0 if release with given tag exists, 1 if 404, other on error.
release_exists() {
  local tag="$1"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$API_BASE/releases/tags/$tag")
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *) echo "[archive-month] release-check unexpected HTTP $code for $tag" >&2; return 2 ;;
  esac
}

# Creates a release; returns the release id on stdout.
create_release() {
  local tag="$1"
  local title="$2"
  local notes="$3"
  local body
  body=$(jq -n --arg tag "$tag" --arg title "$title" --arg notes "$notes" \
    '{tag_name: $tag, name: $title, body: $notes, draft: false, prerelease: false}')
  local resp
  resp=$(curl -sS -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "$body" \
    "$API_BASE/releases")
  local id
  id=$(echo "$resp" | jq -r '.id // empty')
  if [ -z "$id" ]; then
    echo "[archive-month] create_release($tag) failed: $resp" >&2
    return 1
  fi
  echo "$id"
}

# Uploads a file as a release asset.
upload_asset() {
  local rel_id="$1"
  local path="$2"
  local name
  name=$(basename "$path")
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$path" \
    "${UPLOADS_BASE}/releases/${rel_id}/assets?name=${name}")
  case "$code" in
    201|200) return 0 ;;
    *) echo "[archive-month] upload_asset($name) failed HTTP $code" >&2; return 1 ;;
  esac
}

PARTIAL_FAILURES=0
SUCCESSFUL_MONTHS=()

for ym in $MONTHS; do
  TAG="archive-${ym}"
  TARBALL="${WORK_DIR}/reports-${ym}.tar.gz"
  CHECKSUM="${WORK_DIR}/reports-${ym}.sha256"

  if release_exists "$TAG"; then
    echo "[archive-month] $TAG already exists on Releases — skipping"
    continue
  fi

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

  NOTES="Monthly archive of daily reports for ${ym}.

Contents: $(echo "$MONTH_FILES" | wc -l) report JSON files.
Theme: ${ACTIVE_THEME}

These reports were active on the data branch through ${CUTOFF}; this
release is the canonical cold-storage location going forward. The CI
build step hydrates the last HYDRATE_MONTHS months back into
data/reports/ so the static site continues to serve them.

Integrity: sha256 attached as reports-${ym}.sha256."

  REL_ID=$(create_release "$TAG" "Archive ${ym} (${ACTIVE_THEME})" "$NOTES")
  if [ -z "$REL_ID" ]; then
    PARTIAL_FAILURES=$((PARTIAL_FAILURES + 1))
    continue
  fi

  if ! upload_asset "$REL_ID" "$TARBALL" || ! upload_asset "$REL_ID" "$CHECKSUM"; then
    echo "[archive-month] FAILED to upload assets for $TAG — release exists but is empty" >&2
    PARTIAL_FAILURES=$((PARTIAL_FAILURES + 1))
    continue
  fi

  echo "[archive-month] $TAG uploaded"
  SUCCESSFUL_MONTHS+=("$ym")
done

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

REMOVE_PATHS=()
for ym in "${SUCCESSFUL_MONTHS[@]}"; do
  MONTH_FILES=$(echo "$ARCHIVABLE" | grep "^${ym}-")
  for f in $MONTH_FILES; do
    REMOVE_PATHS+=("data/reports/$f")
  done
done

MSG="archive: move $(echo "${SUCCESSFUL_MONTHS[@]}" | tr ' ' ',') reports to Releases (HOT_DAYS=${HOT_DAYS})"

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
