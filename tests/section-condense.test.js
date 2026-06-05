import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  buildSectionFeedSlices,
  dedupeByUrl,
  signalOf,
} from '../src/lib/section-condense.js';

const sectionMap = {
  sourcesForSection: (s) =>
    ({ pulse: ['hackernews', 'lobsters', 'ithome'], market: ['ithome'], tech: [] })[s] ?? [],
};
const DATE = '2026-06-05';
function item(o) {
  return {
    url: `https://x/${o.id}`,
    title: o.id,
    source: o.src,
    published: o.pub ?? '2026-06-05T00:00:00Z',
    ...o,
  };
}

describe('helpers', () => {
  it('ageInDays parses published vs date (UTC midnight)', () => {
    expect(ageInDays('2026-06-03T00:00:00Z', '2026-06-05')).toBe(2);
    expect(ageInDays(null, '2026-06-05')).toBeNull();
  });
  it('signalOf prefers score, then stars, else null', () => {
    expect(signalOf({ score: 5 })).toBe(5);
    expect(signalOf({ stars: 9 })).toBe(9);
    expect(signalOf({})).toBeNull();
  });
  it('dedupeByUrl keeps the higher-signal duplicate', () => {
    const out = dedupeByUrl([
      { url: 'https://x', score: 1 },
      { url: 'https://x', score: 9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(9);
  });
  it('dedupeByUrl keeps all urlless items (no key to dedupe on)', () => {
    const out = dedupeByUrl([{ title: 'a' }, { title: 'b' }]);
    expect(out).toHaveLength(2);
  });
});

describe('buildSectionFeedSlices', () => {
  const feed = [
    item({ id: 'hn1', src: 'hackernews', score: 100 }),
    item({ id: 'hn2', src: 'hackernews', score: 50 }),
    item({ id: 'lo1', src: 'lobsters', score: 30 }),
    item({ id: 'it1', src: 'ithome' }),
    item({ id: 'it2', src: 'ithome', pub: '2026-01-01T00:00:00Z' }),
    item({ id: 'other', src: 'phoronix' }),
  ];

  it('routes items to the section(s) their source feeds', () => {
    const s = buildSectionFeedSlices(feed, { sectionMap, date: DATE });
    expect(s.pulse.items.map((i) => i.source)).toEqual(
      expect.arrayContaining(['hackernews', 'lobsters', 'ithome']),
    );
    expect(s.market.items.map((i) => i.source)).toEqual(['ithome']);
    expect(s.pulse.items.find((i) => i.source === 'phoronix')).toBeUndefined();
  });
  it('drops stale items outside the recency window but keeps undated', () => {
    const s = buildSectionFeedSlices(feed, { sectionMap, date: DATE });
    const ids = s.pulse.items.map((i) => i.title);
    expect(ids).toContain('it1');
    expect(ids).not.toContain('it2');
  });
  it('keeps published + signal; envelope always valid incl. degraded; empty section valid', () => {
    const s = buildSectionFeedSlices(feed, { sectionMap, date: DATE });
    expect(s.pulse.ok).toBe(true);
    expect(s.pulse.items[0]).toHaveProperty('published');
    expect(Array.isArray(s.pulse.degraded)).toBe(true);
    expect(s.tech).toEqual({ ok: false, items: [], degraded: [] });
  });
  it('does NOT trim below the hard ceiling (retention default)', () => {
    const s = buildSectionFeedSlices(feed, { sectionMap, date: DATE, hardCeiling: 1_000_000 });
    expect(s.pulse.items).toHaveLength(4); // hn1,hn2,lo1,it1 (it2 stale, phoronix unrouted)
  });
  it('above the hard ceiling, trims but never empties + keeps a top-signal HN item', () => {
    const s = buildSectionFeedSlices(feed, { sectionMap, date: DATE, hardCeiling: 1, descMax: 10 });
    expect(s.pulse.items.length).toBeGreaterThan(0);
    expect(s.pulse.items.some((i) => i.source === 'hackernews')).toBe(true);
  });
  it('reports degraded sources absent from feedItems', () => {
    const ghostMap = {
      sourcesForSection: (s) => (s === 'pulse' ? ['hackernews', 'ghost-source'] : []),
    };
    const s = buildSectionFeedSlices(feed, { sectionMap: ghostMap, date: DATE });
    expect(s.pulse.degraded).toContain('ghost-source');
    expect(s.pulse.degraded).not.toContain('hackernews');
  });
});
