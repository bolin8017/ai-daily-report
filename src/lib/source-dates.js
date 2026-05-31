// Build a url→published-date map from raw fetcher envelopes, captured in
// collect.js BEFORE condense.js drops the date fields (its DROP set discards
// published/created_at/... to save curator tokens). The Stage 3.5 guard's
// resolveSourceDate() consults this map so it can date sources whose URL has no
// parseable date (substack /p/, hamel.dev/blog, vendor PRs) — exactly the
// sources welded into false "same-week" convergence. Pure: no fs/process.
//
// Only FEED-type sources are mapped. GitHub items (trending/search/developers)
// are intentionally excluded: a repo's created_at/pushed_at is NOT its
// "appeared in trending today" date, so dating them would mis-flag a
// legitimately-trending older repo.

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * @param {Record<string, {items?: object[]}>} feedSources  e.g. { feeds: raw.feeds, arxiv: raw.arxiv }
 * @returns {Record<string, string>}  url → 'YYYY-MM-DD' (first dated writer wins)
 */
export function buildSourceDateMap(feedSources) {
  const map = {};
  for (const src of Object.values(feedSources ?? {})) {
    for (const item of src?.items ?? []) {
      const url = typeof item?.url === 'string' ? item.url : null;
      if (!url) continue;
      const date = normalizeIsoDate(item.published ?? item.isoDate ?? item.pubDate);
      if (date && !map[url]) map[url] = date;
    }
  }
  return map;
}

/**
 * Derive url→age_days (today − publish date) so the synthesizer never does date
 * arithmetic (LLMs are unreliable at it). Skips unparseable dates.
 * @param {Record<string, string>} dateMap  url → 'YYYY-MM-DD'
 * @param {string} todayIso  'YYYY-MM-DD'
 * @returns {Record<string, number>}  url → integer age in days
 */
export function computeAges(dateMap = {}, todayIso) {
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const ages = {};
  if (Number.isNaN(today)) return ages;
  for (const [url, date] of Object.entries(dateMap)) {
    const t = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isNaN(t)) ages[url] = Math.round((today - t) / 86_400_000);
  }
  return ages;
}
