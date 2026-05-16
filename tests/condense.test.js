// Tests for src/lib/condense.js — focuses on the in-memory condenseAll()
// API that src/collect.js depends on.

import { describe, expect, it } from 'vitest';
import { condenseAll } from '../src/lib/condense.js';

function mockFeeds(itemCount) {
  return {
    ok: true,
    items: Array.from({ length: itemCount }, (_, i) => ({
      source: i % 2 === 0 ? 'hackernews' : 'Lobsters',
      title: `Item ${i}`,
      url: `https://example.com/${i}`,
      description: 'x'.repeat(200), // triggers the descMax truncation
      score: 100 - i,
      rank: i + 1,
      readme_excerpt: 'should be dropped',
      creator: 'dropped',
    })),
  };
}

function mockGithub(itemCount, prefix) {
  return {
    ok: true,
    items: Array.from({ length: itemCount }, (_, i) => ({
      source: `github-${prefix}`,
      full_name: `${prefix}-user/${prefix}-repo-${i}`,
      url: `https://github.com/${prefix}-user/${prefix}-repo-${i}`,
      description: 'y'.repeat(150),
      stars: 500 - i,
      rank: i + 1,
      readme_excerpt: 'should be dropped',
      pushed_at: '2026-04-10',
    })),
  };
}

describe('condenseAll', () => {
  const raw = {
    feeds: mockFeeds(80),
    trending: mockGithub(15, 'trending'),
    search: mockGithub(30, 'search'),
    developers: mockGithub(25, 'developers'),
  };

  it('returns an object with all 4 keys', () => {
    const out = condenseAll(raw);
    expect(Object.keys(out).sort()).toEqual(['developers', 'search', 'trending', 'unified']);
  });

  it('drops noisy fields (readme_excerpt, creator, pushed_at)', () => {
    const out = condenseAll(raw);
    const sampleUnified = out.unified.items[0];
    expect(sampleUnified).not.toHaveProperty('readme_excerpt');
    expect(sampleUnified).not.toHaveProperty('creator');
    const sampleTrending = out.trending.items[0];
    expect(sampleTrending).not.toHaveProperty('readme_excerpt');
    expect(sampleTrending).not.toHaveProperty('pushed_at');
  });

  it('truncates description beyond descMax', () => {
    const out = condenseAll(raw);
    const desc = out.unified.items[0].description;
    expect(desc.length).toBeLessThanOrEqual(125); // descMax 120 + "..."
    expect(desc.endsWith('...')).toBe(true);
  });

  it('caps unified-feeds items per source', () => {
    const out = condenseAll(raw);
    const hnCount = out.unified.items.filter((i) => i.source === 'hackernews').length;
    const lobCount = out.unified.items.filter((i) => i.source === 'Lobsters').length;
    // First attempt's caps: hackernews=20, Lobsters=12
    expect(hnCount).toBeLessThanOrEqual(20);
    expect(lobCount).toBeLessThanOrEqual(12);
  });

  it('caps github-trending to ≤12 items', () => {
    const out = condenseAll(raw);
    expect(out.trending.items.length).toBeLessThanOrEqual(12);
  });

  it('sorts by score/stars descending', () => {
    const out = condenseAll(raw);
    const scores = out.unified.items.filter((i) => i.source === 'hackernews').map((i) => i.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('handles empty items arrays gracefully', () => {
    const empty = {
      feeds: { ok: true, items: [] },
      trending: { ok: true, items: [] },
      search: { ok: true, items: [] },
      developers: { ok: true, items: [] },
    };
    const out = condenseAll(empty);
    expect(out.unified.items).toEqual([]);
    expect(out.trending.items).toEqual([]);
    expect(out.search.items).toEqual([]);
    expect(out.developers.items).toEqual([]);
  });
});

describe('condenseFlat scope-quota reservation', () => {
  // Build a search payload mixing 30 high-star global items (1000-971★) with
  // 4 low-star lens-tagged items (200★, 150★, 100★, 90★). Without quota,
  // global ranking culls all 4 lens items (they fall outside the top 25).
  function mockSearchMixedScope() {
    const globalItems = Array.from({ length: 30 }, (_, i) => ({
      source: 'github-search',
      topic: 'llm',
      full_name: `popular/repo-${i}`,
      url: `https://github.com/popular/repo-${i}`,
      description: 'mainstream LLM project',
      stars: 1000 - i,
      _scope: ['global'],
    }));
    const lensItems = [200, 150, 100, 90].map((stars, i) => ({
      source: 'github-search',
      topic: 'kv-cache',
      full_name: `niche/kvcache-${i}`,
      url: `https://github.com/niche/kvcache-${i}`,
      description: 'low-star but lens-targeted',
      stars,
      _scope: ['global', 'phison-aidaptiv'],
    }));
    return { ok: true, items: [...globalItems, ...lensItems] };
  }

  it('reserves slots for lens-tagged items even when out-ranked by global items', () => {
    const raw = {
      feeds: { ok: true, items: [] },
      trending: { ok: true, items: [] },
      search: mockSearchMixedScope(),
      developers: { ok: true, items: [] },
    };
    const out = condenseAll(raw);
    const lensTaggedKept = out.search.items.filter(
      (i) => (i._scope || []).includes('phison-aidaptiv'),
    );
    // First-attempt search cap = 25, quota fraction = 0.25 → ⌊25 × 0.25⌋ = 6.
    // We supplied 4 lens-tagged items, so all 4 should survive.
    expect(lensTaggedKept.length).toBe(4);
  });

  it('preserves _scope field through condense', () => {
    const raw = {
      feeds: { ok: true, items: [] },
      trending: { ok: true, items: [] },
      search: mockSearchMixedScope(),
      developers: { ok: true, items: [] },
    };
    const out = condenseAll(raw);
    for (const item of out.search.items) {
      expect(item._scope).toBeDefined();
      expect(Array.isArray(item._scope)).toBe(true);
    }
  });

  it('falls back to pure global ranking when no lens-tagged items exist', () => {
    const allGlobal = {
      ok: true,
      items: Array.from({ length: 30 }, (_, i) => ({
        source: 'github-search',
        topic: 'llm',
        full_name: `repo/${i}`,
        url: `https://github.com/repo/${i}`,
        stars: 500 - i,
        _scope: ['global'],
      })),
    };
    const raw = {
      feeds: { ok: true, items: [] },
      trending: { ok: true, items: [] },
      search: allGlobal,
      developers: { ok: true, items: [] },
    };
    const out = condenseAll(raw);
    // Sorted by stars desc — first item must be the highest-star one
    expect(out.search.items[0].stars).toBe(500);
    expect(out.search.items.length).toBeLessThanOrEqual(25);
  });
});
