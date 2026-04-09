#!/usr/bin/env node
// Build data/feeds-snapshot.json — a committed, condensed snapshot of the
// unified feeds that the 11ty build reads in CI (without needing tmp/).
//
// Two usage modes:
//   - Import: `import { buildSnapshot } from './snapshot.js'` → takes the
//     unified-feeds object in memory and writes the snapshot file
//   - Standalone: `node src/lib/snapshot.js` — reads tmp/unified-feeds.json

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DST = 'data/feeds-snapshot.json';
const MAX_PER_SOURCE = 15;

/**
 * Build the committed feeds-snapshot from an in-memory unified-feeds object.
 * @param {object} feeds - the result of fetchFeeds() / raw.feeds from runFetchers()
 */
export function buildSnapshot(feeds) {
  if (!Array.isArray(feeds?.items)) {
    throw new Error('[snapshot] feeds.items is not an array');
  }
  if (!feeds.ok) {
    console.error(`[snapshot] WARN: feeds.ok=false (${feeds.items.length} items survived)`);
  }

  // Group by source, cap each to MAX_PER_SOURCE, strip noisy fields.
  // The cap keeps the committed snapshot under ~200 KB so git history stays friendly.
  const bySource = {};
  for (const item of feeds.items) {
    const source = item.source || '其他';
    if (!bySource[source]) bySource[source] = [];
    if (bySource[source].length >= MAX_PER_SOURCE) continue;
    bySource[source].push({
      feed_name: source,
      title: item.title || item.full_name || '',
      url: item.url || '',
      description: (item.description || '').slice(0, 300),
      author: item.author || '',
      published: item.published || null,
      tags: item.tags || [],
      score: item.score,
      num_comments: item.num_comments,
      rank: item.rank,
    });
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    sources: Object.keys(bySource).length,
    total_items: Object.values(bySource).reduce((a, b) => a + b.length, 0),
    by_source: bySource,
  };

  writeFileSync(DST, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.error(`✓ ${DST} written: ${snapshot.sources} sources, ${snapshot.total_items} items`);
  return snapshot;
}

// --- Standalone mode ---

function runStandalone() {
  const SRC = 'tmp/unified-feeds.json';
  if (!existsSync(SRC)) {
    console.error(`[snapshot] FATAL: ${SRC} not found — run fetchers first`);
    process.exit(1);
  }
  const feeds = JSON.parse(readFileSync(SRC, 'utf8'));
  buildSnapshot(feeds);
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) runStandalone();
