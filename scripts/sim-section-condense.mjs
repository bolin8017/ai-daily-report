// Debug: replay a captured data/staging into the section engine and print
// per-section item counts + token sizes. Usage: node scripts/sim-section-condense.mjs
//
// NOTE: reads from feeds-pulse.json (the post-Plan5-cutover sole feed staging).
// Items here were built from raw feeds so published/score/_scope are present —
// the recency window is active and counts reflect a true replay.
import { readFileSync } from 'node:fs';
import { buildSectionFeedSlices, FEED_SECTIONS } from '../src/lib/section-condense.js';
import { loadSectionMap } from '../src/lib/section-map.js';

const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
let feed = [];
try {
  feed = JSON.parse(readFileSync('data/staging/feeds-pulse.json', 'utf8')).items ?? [];
} catch {
  console.error('no data/staging/feeds-pulse.json — run Stage 1 first');
  process.exit(1);
}
const map = await loadSectionMap();
const slices = buildSectionFeedSlices(feed, { sectionMap: map, date });
for (const s of FEED_SECTIONS) {
  const tok = Math.round(JSON.stringify(slices[s]).length / 1.7);
  console.error(
    `${s}: ${slices[s].items.length} items ~${tok} tok  degraded=[${slices[s].degraded.join(',')}]`,
  );
}
