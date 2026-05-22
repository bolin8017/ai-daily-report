// Site homepages rendered as markdown vary widely, but blog-style sites tend
// to share two patterns:
//   - **[Title](url)** (link in bold) → most common for atom-rendered entries
//   - ### [Title](url)              → section heading for new entries
// We dedupe by URL and skip nav/footer links by requiring title length >= 15
// and skipping URLs containing fragment / common navigation paths.
const NAV_PATTERNS =
  /\/(login|signup|terms|privacy|search|tag|category|atom|rss|feed|about|contact|sitemap)(?:\/|$|\?)/i;

export function extractRSSPost(markdown, { sourceName, category, sourceUrl } = {}) {
  const items = [];
  const seen = new Set();
  const patterns = [
    /\*\*\[([^\]]{15,})\]\((https?:\/\/[^)]+)\)\*\*/g,
    /^#{2,4}\s+\[([^\]]{15,})\]\((https?:\/\/[^)]+)\)\s*$/gm,
  ];
  let rank = 0;
  for (const re of patterns) {
    while (true) {
      const m = re.exec(markdown);
      if (m === null) break;
      const title = m[1].trim();
      const url = m[2];
      if (seen.has(url)) continue;
      if (url === sourceUrl) continue;
      if (NAV_PATTERNS.test(url)) continue;
      if (url.includes('#')) continue;
      seen.add(url);
      rank++;
      items.push({
        source: sourceName ?? 'unknown',
        category,
        title,
        url,
        published: null,
        rank,
      });
      if (rank >= 30) break;
    }
    if (rank >= 30) break;
  }
  return items;
}
