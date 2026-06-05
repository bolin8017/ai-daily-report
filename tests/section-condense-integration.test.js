import { describe, expect, it } from 'vitest';
import { buildSectionFeedSlices } from '../src/lib/section-condense.js';
import { loadSectionMap } from '../src/lib/section-map.js';

function mk(source, n, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    source,
    title: `${source}-${i}`,
    url: `https://${source}/${i}`,
    published: '2026-06-05T00:00:00Z',
    description: 'x'.repeat(180),
    ...(opts.scored ? { score: 100 - i } : {}),
  }));
}

describe('section-condense integration (real section map)', () => {
  it('each feed section fits the hard ceiling and retains its in-window pool', async () => {
    const map = await loadSectionMap();
    const feed = [
      ...mk('hackernews', 15, { scored: true }),
      ...mk('lobsters', 15, { scored: true }),
      ...mk('ithome', 15),
      ...mk('segmentfault', 15),
      ...mk('simon-willison', 5),
    ];
    const slices = buildSectionFeedSlices(feed, { sectionMap: map, date: '2026-06-05' });
    for (const s of ['pulse', 'market', 'tech']) {
      const tokens = JSON.stringify(slices[s]).length / 1.7;
      expect(tokens).toBeLessThan(50_000);
    }
    const pulseSources = new Set(slices.pulse.items.map((i) => i.source));
    expect(pulseSources.has('hackernews')).toBe(true);
    expect(pulseSources.has('ithome')).toBe(true);
    // nothing trimmed below the ceiling: all in-window fixture items for pulse retained
    expect(slices.pulse.items.length).toBeGreaterThanOrEqual(50);
  });
});
