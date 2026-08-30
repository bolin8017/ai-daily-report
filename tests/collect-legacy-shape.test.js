// Review finding collect-1: mapResultsToLegacyShape hardcoded feeds.ok=true,
// and the count-based correction only runs on the Miniflux path — so with
// Miniflux unconfigured, a total feed-chain outage still reported
// {ok: true, count: 0} into metadata.sources.feeds → report.meta.source_health,
// rendering the feed half green on a day it collected nothing.

import { describe, expect, it } from 'vitest';
import { bucketSourceIds, mapResultsToLegacyShape } from '../src/collect.js';

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

// The bucket → source-id mapping is what lets the production notice report a
// degraded chain against the bucket it emptied, instead of naming the same
// failure twice in two namespaces (`arxiv=empty, arxiv-cs-ai`).
describe('bucketSourceIds', () => {
  it('names the single chain behind each structured bucket', () => {
    const map = bucketSourceIds(sources);
    expect(map.trending).toEqual(['github-trending']);
    expect(map.arxiv).toEqual(['arxiv-cs-ai']);
    expect(map.search).toEqual(['github-search-topics']);
    expect(map.developers).toEqual(['github-developers']);
    expect(map.hf_trending).toEqual(['hf-trending']);
    expect(map.mops).toEqual(['mops-disclosure']);
  });

  it('derives the many-chain buckets from the source registry', () => {
    const map = bucketSourceIds([
      ...sources,
      { id: 'bfcl', itemType: 'leaderboard-entry' },
      { id: 'lmarena', itemType: 'leaderboard-entry' },
    ]);
    expect(map.feeds).toEqual(['feed-a', 'hn']);
    expect(map.leaderboards).toEqual(['bfcl', 'lmarena']);
  });

  it('covers every bucket mapResultsToLegacyShape produces', () => {
    const out = mapResultsToLegacyShape({}, sources);
    expect(Object.keys(bucketSourceIds(sources)).sort()).toEqual(Object.keys(out).sort());
  });
});
