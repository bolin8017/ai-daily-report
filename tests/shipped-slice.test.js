import { describe, expect, it } from 'vitest';
import { buildShippedSlice } from '../src/lib/section-condense.js';

describe('buildShippedSlice', () => {
  const condensed = {
    unified: { ok: true, items: [{ source: 'hackernews' }] },
    trending: { ok: true, items: [{ source: 'github-trending', stars: 9 }] },
    search: { ok: true, items: [{ source: 'github-search', stars: 5 }] },
    developers: { ok: true, items: [{ source: 'github-developers', developer_region: 'taiwan' }] },
  };

  it('bundles trending/search/developers items into one shipped envelope', () => {
    const s = buildShippedSlice(condensed);
    expect(s.trending).toEqual(condensed.trending.items);
    expect(s.search).toEqual(condensed.search.items);
    expect(s.developers).toEqual(condensed.developers.items);
    expect(s.ok).toBe(true);
    expect(s).not.toHaveProperty('unified');
  });

  it('ok is false only when all three github inputs are empty', () => {
    const empty = { trending: { items: [] }, search: { items: [] }, developers: { items: [] } };
    expect(buildShippedSlice(empty).ok).toBe(false);
    expect(
      buildShippedSlice({
        trending: { items: [{ x: 1 }] },
        search: { items: [] },
        developers: { items: [] },
      }).ok,
    ).toBe(true);
  });

  it('tolerates missing/undefined condensed inputs (→ empty arrays)', () => {
    expect(buildShippedSlice({})).toEqual({ ok: false, trending: [], search: [], developers: [] });
  });
});
