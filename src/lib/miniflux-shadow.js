// Pure: compare chain-fetched feed items against Miniflux-fetched ones, per
// source. Used during the shadow phase to validate Miniflux coverage before the
// cutover. No I/O.
//
// Note: sources intentionally NOT in Miniflux (dev-to-top, anthropic-news — they
// stay on the RSSHub Node chain; HN/Lobsters — score-bearing) will show up under
// onlyInChain by design; that is expected, not a coverage gap.
function countBySource(items) {
  const m = {};
  for (const it of items) m[it.source] = (m[it.source] ?? 0) + 1;
  return m;
}

export function compareFeedCounts(chainItems, minifluxItems) {
  const chain = countBySource(chainItems);
  const miniflux = countBySource(minifluxItems);
  const sources = [...new Set([...Object.keys(chain), ...Object.keys(miniflux)])].sort();
  const bySource = {};
  for (const s of sources) bySource[s] = { chain: chain[s] ?? 0, miniflux: miniflux[s] ?? 0 };
  return {
    bySource,
    totals: { chain: chainItems.length, miniflux: minifluxItems.length },
    onlyInChain: sources.filter((s) => (chain[s] ?? 0) > 0 && (miniflux[s] ?? 0) === 0),
    onlyInMiniflux: sources.filter((s) => (miniflux[s] ?? 0) > 0 && (chain[s] ?? 0) === 0),
  };
}
