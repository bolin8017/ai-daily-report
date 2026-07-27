// Missing-report-day detection (ops-2, 2026-07-21 operational reliability
// review): 2026-07-02/03 had no run, no notice, no report — nothing noticed
// the calendar hole. The production runner diffs the recent calendar window
// against the reports actually on origin/data and surfaces gaps in the run
// state + delivery notices. Detection only: a missed day usually cannot be
// faithfully regenerated later (its staging inputs are gone), so the value
// is catching the hole while same-day recovery is still possible.

export const DEFAULT_LOOKBACK_DAYS = 14;

const REPORT_PATH_RE = /^data\/reports\/(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Extract report dates from `git ls-tree --name-only -r origin/data` output.
 * Ignores non-report paths (feeds snapshot, legacy lenses/ subdir, etc.).
 *
 * @param {string} lsTreeOutput
 * @returns {string[]} YYYY-MM-DD, in input order
 */
export function parseReportDates(lsTreeOutput) {
  return (lsTreeOutput ?? '')
    .split('\n')
    .map((line) => line.trim().match(REPORT_PATH_RE)?.[1])
    .filter(Boolean);
}

/**
 * Days in [today − lookbackDays, today − 1] with no report. Today is excluded:
 * producing today's report is the running pipeline's own job, checked
 * separately by the publish tail.
 *
 * @param {object} opts
 * @param {string[]} opts.presentDates YYYY-MM-DD dates that have a report
 * @param {string} opts.today YYYY-MM-DD (report timezone)
 * @param {number} [opts.lookbackDays]
 * @returns {string[]} missing YYYY-MM-DD, ascending
 */
/**
 * Gap scan over a raw `git ls-tree` listing, `null`-aware: a `null` listing
 * means the listing itself could not be produced (git fetch/ls-tree failed),
 * which is indistinguishable from "every day missing" if scanned — so the
 * scan is skipped instead of flooding the notice with the whole window.
 * An empty-but-successful listing (bootstrap data branch) still scans.
 *
 * @param {object} opts
 * @param {string|null} opts.listing ls-tree output, or null on git failure
 * @param {string} opts.today YYYY-MM-DD (report timezone)
 * @param {number} [opts.lookbackDays]
 * @returns {{skipped: boolean, missingDays: string[]|null}}
 */
export function scanReportGaps({ listing, today, lookbackDays = DEFAULT_LOOKBACK_DAYS }) {
  if (listing == null) return { skipped: true, missingDays: null };
  return {
    skipped: false,
    missingDays: findMissingReportDays({
      presentDates: parseReportDates(listing),
      today,
      lookbackDays,
    }),
  };
}

export function findMissingReportDays({
  presentDates,
  today,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
}) {
  const present = new Set(presentDates);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const missing = [];
  for (let back = lookbackDays; back >= 1; back--) {
    const day = new Date(todayMs - back * 86_400_000).toISOString().slice(0, 10);
    if (!present.has(day)) missing.push(day);
  }
  return missing;
}
