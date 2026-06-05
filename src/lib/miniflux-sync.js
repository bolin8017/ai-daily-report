import { normUrl } from './feeds-opml.js';

// Pure reconcile planner: compare the desired OPML feed list against what
// Miniflux already has. Never auto-deletes — feeds present in Miniflux but not
// in the OPML are reported as orphans for the operator to decide.
export function planMinifluxSync({ opmlFeeds, existingFeeds, existingCategories }) {
  const haveCats = new Set(existingCategories.map((c) => c.title));
  const haveFeeds = new Set(existingFeeds.map((f) => normUrl(f.feed_url)));
  const wantCats = [...new Set(opmlFeeds.map((f) => f.category).filter(Boolean))];

  const createCategories = wantCats.filter((c) => !haveCats.has(c));
  const createFeeds = opmlFeeds
    .filter((f) => !haveFeeds.has(normUrl(f.url)))
    .map((f) => ({ feed_url: f.url, category: f.category, source: f.id }));

  const wantUrls = new Set(opmlFeeds.map((f) => normUrl(f.url)));
  const orphanFeeds = existingFeeds.map((f) => f.feed_url).filter((u) => !wantUrls.has(normUrl(u)));

  return { createCategories, createFeeds, orphanFeeds };
}
