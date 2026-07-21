#!/usr/bin/env bash
# Phase 3 hydrate job — downloads the last HYDRATE_MONTHS months of archived
# reports from GitHub Releases into data/reports/ so 11ty pagination can
# render them at build time.
#
# Uses curl + GitHub API directly (no gh CLI dependency); works in CI with
# the default GITHUB_TOKEN.
#
# Idempotent: skips months whose reports are already on disk.
#
# Usage:
#   bash scripts/hydrate-archive.sh
#
# Env:
#   HYDRATE_MONTHS=12        # how many months back to hydrate
#   GITHUB_REPO=bolin8017/ai-daily-report
#   GITHUB_TOKEN             # optional for public repos but recommended
#
# Exits:
#   0 success (incl. partial — best-effort hydrate)

set -uo pipefail
cd "$(dirname "$0")/.."

HYDRATE_MONTHS="${HYDRATE_MONTHS:-12}"
GITHUB_REPO="${GITHUB_REPO:-bolin8017/ai-daily-report}"
API_BASE="https://api.github.com/repos/${GITHUB_REPO}"
REPORTS_DIR="data/reports"
mkdir -p "$REPORTS_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "[hydrate-archive] WARN: curl not installed — skipping hydration" >&2
  exit 0
fi

THIS_MONTH=$(TZ=Asia/Taipei date +%Y-%m)
MONTHS=()
for i in $(seq 1 "$HYDRATE_MONTHS"); do
  YM=$(date -d "$THIS_MONTH-01 - $i months" +%Y-%m)
  MONTHS+=("$YM")
done

echo "[hydrate-archive] targeting last $HYDRATE_MONTHS months: ${MONTHS[*]}"

WORK_DIR=$(mktemp -d -t hydrate.XXXXXX)
trap "rm -rf '$WORK_DIR'" EXIT

AUTH_HEADER=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # Keep the token off curl argv (visible in /proc/<pid>/cmdline) — curl
  # reads the header from a 0600 file instead.
  AUTH_FILE="$WORK_DIR/auth-header"
  (umask 077; printf 'Authorization: token %s\n' "$GITHUB_TOKEN" > "$AUTH_FILE")
  AUTH_HEADER=(-H "@$AUTH_FILE")
fi

# Fetch release JSON for tag $1; emit asset download URLs (name<TAB>url) on stdout
release_assets() {
  local tag="$1"
  curl -sS "${AUTH_HEADER[@]}" \
    -H "Accept: application/vnd.github+json" \
    "$API_BASE/releases/tags/$tag" \
    | jq -r '.assets[]? | [.name, .browser_download_url] | @tsv'
}

HYDRATED=0
SKIPPED=0
FAILED=0

for ym in "${MONTHS[@]}"; do
  TAG="archive-${ym}"

  EXISTING=$(find "$REPORTS_DIR" -maxdepth 1 -name "${ym}-*.json" 2>/dev/null | wc -l)
  if [ "$EXISTING" -gt 0 ]; then
    echo "[hydrate-archive] $ym already has $EXISTING report(s) locally — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  ASSETS=$(release_assets "$TAG" 2>/dev/null || true)
  if [ -z "$ASSETS" ]; then
    echo "[hydrate-archive] $TAG not on Releases (or no assets) — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  TAR_URL=$(echo "$ASSETS" | awk -F$'\t' "/^reports-${ym}\\.tar\\.gz/ {print \$2}")
  SHA_URL=$(echo "$ASSETS" | awk -F$'\t' "/^reports-${ym}\\.sha256/ {print \$2}")
  if [ -z "$TAR_URL" ] || [ -z "$SHA_URL" ]; then
    echo "[hydrate-archive] $TAG missing tarball or sha256 asset — skipping" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  if ! curl -fsSL "${AUTH_HEADER[@]}" -o "${WORK_DIR}/reports-${ym}.tar.gz" "$TAR_URL"; then
    echo "[hydrate-archive] failed to download $TAR_URL" >&2
    FAILED=$((FAILED + 1))
    continue
  fi
  if ! curl -fsSL "${AUTH_HEADER[@]}" -o "${WORK_DIR}/reports-${ym}.sha256" "$SHA_URL"; then
    echo "[hydrate-archive] failed to download $SHA_URL" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  (cd "$WORK_DIR" && sha256sum -c "reports-${ym}.sha256" >/dev/null 2>&1) || {
    echo "[hydrate-archive] $TAG sha256 mismatch — skipping extract" >&2
    FAILED=$((FAILED + 1))
    continue
  }

  # Extract to a scratch dir first: a tarball that dies mid-extract must not
  # leave a partial month in REPORTS_DIR (the already-has-reports check above
  # would then skip re-hydrating it on the next build).
  EXTRACT_DIR="${WORK_DIR}/extract-${ym}"
  mkdir -p "$EXTRACT_DIR"
  if ! tar -xzf "${WORK_DIR}/reports-${ym}.tar.gz" -C "$EXTRACT_DIR"; then
    echo "[hydrate-archive] $TAG extraction failed (corrupt tarball?) — skipping" >&2
    FAILED=$((FAILED + 1))
    continue
  fi
  COUNT=$(find "$EXTRACT_DIR" -maxdepth 1 -name "${ym}-*.json" | wc -l)
  if [ "$COUNT" -eq 0 ]; then
    echo "[hydrate-archive] $TAG extracted no ${ym} reports — skipping" >&2
    FAILED=$((FAILED + 1))
    continue
  fi
  mv "$EXTRACT_DIR"/*.json "$REPORTS_DIR"/
  echo "[hydrate-archive] $ym hydrated ($COUNT files)"
  HYDRATED=$((HYDRATED + 1))
done

echo "[hydrate-archive] done: hydrated=$HYDRATED skipped=$SKIPPED failed=$FAILED"
if [ "$FAILED" -gt 0 ]; then
  # Hydrate stays best-effort by design (exit 0 — a missing cold month must
  # not block the site build), but surface the gap in the Actions UI instead
  # of a log line nobody reads.
  echo "::warning title=hydrate-archive::$FAILED month(s) failed to hydrate — their archive pages will be missing from this build"
fi
exit 0
