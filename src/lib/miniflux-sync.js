import { normUrl } from './feeds-opml.js';

// Pure reconcile planner: compare the desired OPML feed list against what
// Miniflux already has. Never auto-deletes — feeds present in Miniflux but not
// in the OPML are reported as orphans for the operator to decide.
//
// block_filter_entry_rules is the one attribute reconciled on feeds that
// already exist (the rest are applied only at creation): the OPML is its source
// of truth, so a feed whose rules differ — including rules set by hand in the
// Miniflux UI, or a rule since removed from the registry — is planned for an
// update to the OPML value ('' when the outline declares none).
export function planMinifluxSync({ opmlFeeds, existingFeeds, existingCategories }) {
  const haveCats = new Set(existingCategories.map((c) => c.title));
  const haveFeeds = new Set(existingFeeds.map((f) => normUrl(f.feed_url)));
  const wantCats = [...new Set(opmlFeeds.map((f) => f.category).filter(Boolean))];

  const createCategories = wantCats.filter((c) => !haveCats.has(c));
  const createFeeds = opmlFeeds
    .filter((f) => !haveFeeds.has(normUrl(f.url)))
    .map((f) => ({
      feed_url: f.url,
      category: f.category,
      source: f.id,
      ...(f.userAgent ? { userAgent: f.userAgent } : {}),
      ...(f.blockFilterEntryRules ? { blockFilterEntryRules: f.blockFilterEntryRules } : {}),
    }));

  // A redirected feed is stored under its final url, so fall back to the title
  // the sync tags every feed with (its source id) to still reach it.
  const existingByUrl = new Map(existingFeeds.map((f) => [normUrl(f.feed_url), f]));
  const existingByTitle = new Map(existingFeeds.map((f) => [f.title, f]));
  const updateFeeds = [];
  for (const f of opmlFeeds) {
    const have = existingByUrl.get(normUrl(f.url)) ?? existingByTitle.get(f.id);
    if (!have) continue;
    const want = f.blockFilterEntryRules ?? '';
    if ((have.block_filter_entry_rules ?? '') !== want) {
      updateFeeds.push({ id: have.id, source: f.id, block_filter_entry_rules: want });
    }
  }

  const wantUrls = new Set(opmlFeeds.map((f) => normUrl(f.url)));
  const orphanFeeds = existingFeeds.map((f) => f.feed_url).filter((u) => !wantUrls.has(normUrl(u)));

  return { createCategories, createFeeds, updateFeeds, orphanFeeds };
}
