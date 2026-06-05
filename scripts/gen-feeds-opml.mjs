#!/usr/bin/env node
// One-time generator: emit themes/<theme>/feeds.opml from the registry's
// pure-RSS sources (itemType 'rss-post' minus lobsters, which keeps its
// score-bearing JSON fetcher). category = section (pulse|market|tech) from the
// section map; condense routes by source id, so category is only used by
// Miniflux to organize feeds.
//
// Only NATIVE-RSS sources go to Miniflux (chain step 0 = native-rss): Miniflux
// fetches their feed url directly. RSSHub-dependent sources (step 0 = rsshub:
// dev-to-top, anthropic-news) are intentionally EXCLUDED — they stay on the
// in-repo chain pointing at the self-hosted RSSHub, which is bound loopback-only
// (127.0.0.1) for security, and Miniflux's SSRF guard refuses to fetch loopback.
import { writeFileSync } from 'node:fs';
import { ACTIVE_THEME } from '../src/lib/config.js';
import { loadSectionMap } from '../src/lib/section-map.js';
import registry from '../src/sources/registry.js';

const FEED_SECTIONS = ['pulse', 'market', 'tech'];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// All exported sources have a native-rss step 0 (see the filter in main()), so
// the feed url is simply that step's config.url.
function feedUrlFor(source) {
  return source.chain?.[0]?.config?.url ?? '';
}

async function main() {
  const sectionMap = await loadSectionMap();
  const sourceToSection = {};
  for (const section of FEED_SECTIONS) {
    for (const id of sectionMap.sourcesForSection(section)) sourceToSection[id] = section;
  }

  const moved = registry.filter(
    (s) =>
      s.itemType === 'rss-post' && s.id !== 'lobsters' && s.chain?.[0]?.provider === 'native-rss',
  );
  const outlines = moved.map((s) => {
    const url = feedUrlFor(s);
    const category = sourceToSection[s.id] ?? '';
    if (!url) throw new Error(`no feed url derivable for ${s.id}`);
    if (!category) console.error(`[gen-feeds-opml] WARN: ${s.id} not in any section map`);
    return `    <outline text="${esc(s.id)}" title="${esc(s.label)}" type="rss" xmlUrl="${esc(url)}" category="${esc(category)}"/>`;
  });

  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>ai-daily-report feeds (${ACTIVE_THEME})</title></head>
  <body>
${outlines.join('\n')}
  </body>
</opml>
`;
  const out = `themes/${ACTIVE_THEME}/feeds.opml`;
  writeFileSync(out, opml);
  console.error(`wrote ${moved.length} feeds to ${out}`);
}

main().catch((e) => {
  console.error(`[gen-feeds-opml] FATAL: ${e.message}`);
  process.exit(1);
});
