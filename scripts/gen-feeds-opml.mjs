#!/usr/bin/env node
// One-time generator: emit themes/<theme>/feeds.opml from the registry's
// pure-RSS sources (itemType 'rss-post' minus lobsters, which keeps its
// score-bearing JSON fetcher). category = section (pulse|market|tech) from the
// section map; condense routes by source id, so category is only used by
// Miniflux to organize feeds.
//
// Feed URL per source is chosen by the chain's FIRST provider:
//  - native-rss  -> use its config.url (Miniflux fetches the native feed direct)
//  - rsshub      -> use the local RSSHub instance + route (no native feed exists)
import { writeFileSync } from 'node:fs';
import { ACTIVE_THEME } from '../src/lib/config.js';
import { loadSectionMap } from '../src/lib/section-map.js';
import registry from '../src/sources/registry.js';

const FEED_SECTIONS = ['pulse', 'market', 'tech'];
const RSSHUB_BASE = process.env.RSSHUB_LOCAL_URL ?? 'http://localhost:1200';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function feedUrlFor(source) {
  const step0 = source.chain?.[0];
  if (step0?.provider === 'native-rss' && step0.config?.url) return step0.config.url;
  if (step0?.provider === 'rsshub' && step0.config?.route) {
    return `${RSSHUB_BASE}${step0.config.route}`;
  }
  // Fallback: first chain step that carries a url (should not happen for feeds).
  return source.chain?.find((c) => c.config?.url)?.config?.url ?? '';
}

async function main() {
  const sectionMap = await loadSectionMap();
  const sourceToSection = {};
  for (const section of FEED_SECTIONS) {
    for (const id of sectionMap.sourcesForSection(section)) sourceToSection[id] = section;
  }

  const moved = registry.filter((s) => s.itemType === 'rss-post' && s.id !== 'lobsters');
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
