// Report navigation: which archived reports the date switcher offers, and what
// sits on either side of a given day.
//
// The switcher lists only reports that render in the current layout.
// site/_includes/v2/unified.njk branches on `report.discoveries` to choose the
// current tab set over the legacy 精選/上線 pair, so that key's presence is
// exactly the line between a page a reader can switch to and one they cannot.
//
// All three exports are pure. eleventy.config.js applies them to the same array
// the archive pagination is built from, which is what guarantees every
// navigable date has a generated page.

/**
 * Reports that render in the current layout, newest first.
 *
 * @param {{date: string, discoveries?: object}[]} reports
 * @returns {{date: string}[]}
 */
export function selectSwitchable(reports) {
  return (reports ?? [])
    .filter((r) => r?.date && r.discoveries)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * The older and newer neighbours of `date` within a newest-first list.
 *
 * Both sides are null when `date` is absent — the case a pre-cutover archive
 * page lands in, where rendering no arrows is the correct outcome.
 *
 * @param {{date: string}[]} list - newest-first, as returned by selectSwitchable
 * @param {string} date
 * @returns {{prev: object|null, next: object|null}}
 */
export function neighborsOf(list, date) {
  const items = list ?? [];
  const i = items.findIndex((r) => r?.date === date);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: items[i + 1] ?? null,
    next: items[i - 1] ?? null,
  };
}

/**
 * Group a newest-first list into months for the index page. Input order is
 * preserved, so a sorted list yields months newest-first with their days in
 * the same direction.
 *
 * @param {{date: string}[]} list
 * @returns {{month: string, days: {date: string, day: string}[]}[]}
 */
export function groupByMonth(list) {
  const out = [];
  for (const r of list ?? []) {
    const month = r.date.slice(0, 7);
    let bucket = out[out.length - 1];
    if (!bucket || bucket.month !== month) {
      bucket = { month, days: [] };
      out.push(bucket);
    }
    bucket.days.push({ date: r.date, day: r.date.slice(8, 10) });
  }
  return out;
}
