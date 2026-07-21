// Review finding collect-1: mapResultsToLegacyShape hardcoded feeds.ok=true,
// and the count-based correction only runs on the Miniflux path — so with
// Miniflux unconfigured, a total feed-chain outage still reported
// {ok: true, count: 0} into metadata.sources.feeds → report.meta.source_health,
// rendering the feed half green on a day it collected nothing.

import { describe, expect, it } from 'vitest';
import { mapResultsToLegacyShape } from '../src/collect.js';

const sources = [
  { id: 'feed-a', itemType: 'rss-post' },
  { id: 'hn', itemType: 'hn-story' },
  { id: 'github-trending', itemType: 'repo' },
];

describe('mapResultsToLegacyShape', () => {
  it('reports feeds.ok=false when every feed chain returned zero items', () => {
    const out = mapResultsToLegacyShape(
      {
        'feed-a': { ok: false, items: [] },
        hn: { ok: false, items: [] },
        'github-trending': { ok: true, items: [{ full_name: 'o/r' }] },
      },
      sources,
    );
    expect(out.feeds.ok).toBe(false);
    expect(out.feeds.items).toEqual([]);
    expect(out.trending.ok).toBe(true);
  });

  it('reports feeds.ok=true when any feed chain delivered items', () => {
    const out = mapResultsToLegacyShape(
      { 'feed-a': { ok: true, items: [{ title: 'x' }] } },
      sources,
    );
    expect(out.feeds.ok).toBe(true);
    expect(out.feeds.items).toHaveLength(1);
  });
});
