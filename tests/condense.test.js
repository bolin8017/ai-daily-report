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
