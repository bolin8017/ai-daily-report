#!/usr/bin/env bash
# Phase 3 hydrate job — downloads the last HYDRATE_MONTHS months of
# archived reports from GitHub Releases into data/reports/ so 11ty
# pagination can render them at build time.
#
# Designed to be safe to run in CI (no auth needed for public repo's
# Releases; uses gh CLI which respects GITHUB_TOKEN if present).
#
# Idempotent: skips months already present in data/reports/.
#
# Usage:
#   bash scripts/hydrate-archive.sh
#
# Env:
#   HYDRATE_MONTHS=12   # how many months back to hydrate
#   ACTIVE_THEME=ai-builder (informational; archives are theme-agnostic in shape)
#
# Exits:
#   0 success (incl. partial — best-effort hydrate)
#   1 missing dependency

set -uo pipefail
cd "$(dirname "$0")/.."

HYDRATE_MONTHS="${HYDRATE_MONTHS:-12}"
REPORTS_DIR="data/reports"
mkdir -p "$REPORTS_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "[hydrate-archive] WARN: gh CLI not installed — skipping hydration" >&2
  exit 0
fi

# Compute last HYDRATE_MONTHS months as YYYY-MM strings.
THIS_MONTH=$(TZ=Asia/Taipei date +%Y-%m)
MONTHS=()
for i in $(seq 1 "$HYDRATE_MONTHS"); do
  YM=$(date -d "$THIS_MONTH-01 - $i months" +%Y-%m)
  MONTHS+=("$YM")
done

echo "[hydrate-archive] targeting last $HYDRATE_MONTHS months: ${MONTHS[*]}"

WORK_DIR=$(mktemp -d -t hydrate.XXXXXX)
trap "rm -rf '$WORK_DIR'" EXIT

HYDRATED=0
SKIPPED=0
FAILED=0

for ym in "${MONTHS[@]}"; do
  TAG="archive-${ym}"

  # Check if any reports for this month are already present.
  EXISTING=$(find "$REPORTS_DIR" -maxdepth 1 -name "${ym}-*.json" 2>/dev/null | wc -l)
  if [ "$EXISTING" -gt 0 ]; then
    echo "[hydrate-archive] $ym already has $EXISTING report(s) locally — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Try to download the Release tarball.
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    echo "[hydrate-archive] $TAG not on Releases — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if ! gh release download "$TAG" -p "reports-${ym}.tar.gz" -p "reports-${ym}.sha256" -D "$WORK_DIR"; then
    echo "[hydrate-archive] failed to download $TAG" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  # Verify sha256
  (cd "$WORK_DIR" && sha256sum -c "reports-${ym}.sha256" >/dev/null 2>&1) || {
    echo "[hydrate-archive] $TAG sha256 mismatch — skipping extract" >&2
    FAILED=$((FAILED + 1))
    continue
  }

  # Extract into data/reports/
  tar -xzf "${WORK_DIR}/reports-${ym}.tar.gz" -C "$REPORTS_DIR"
  COUNT=$(find "$REPORTS_DIR" -maxdepth 1 -name "${ym}-*.json" | wc -l)
  echo "[hydrate-archive] $ym hydrated ($COUNT files)"
  HYDRATED=$((HYDRATED + 1))
done

echo "[hydrate-archive] done: hydrated=$HYDRATED skipped=$SKIPPED failed=$FAILED"
exit 0
