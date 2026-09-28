import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessFeedHealth,
  feedHealthNote,
  fetchMinifluxFeedHealth,
  normalizeEntries,
} from '../src/fetchers/miniflux.js';
import { StagingMetadataSchema } from '../src/schemas/staging.js';

const KNOWN = new Set(['simon-willison', 'lwn']);

const ENTRIES = [
  {
    title: 'Post A',
    url: 'https://simonwillison.net/2026/a',
    content: '<p>Hello <b>world</b></p>',
    author: 'Simon',
    published_at: '2026-06-04T10:00:00Z',
    feed: { title: 'simon-willison', feed_url: 'https://simonwillison.net/atom/everything/' },
  },
  {
    title: 'Entry from an untagged/unknown feed',
    url: 'https://other.com/x',
    content: 'x',
    feed: { title: 'not-a-registry-source', feed_url: 'https://other.com/feed' },
  },
];

describe('normalizeEntries', () => {
  it('maps feed.title -> source id, strips HTML, keeps section-condense fields', () => {
    const items = normalizeEntries(ENTRIES, KNOWN);
    expect(items).toHaveLength(1); // unknown source skipped
    expect(items[0]).toMatchObject({
      source: 'simon-willison',
      title: 'Post A',
      url: 'https://simonwillison.net/2026/a',
      description: 'Hello world',
      published: '2026-06-04T10:00:00Z',
      rank: 1,
    });
    expect(items[0]).not.toHaveProperty('_scope'); // added later by tagItemScope
    expect(items[0]).not.toHaveProperty('score'); // score-less by design
  });

  it('renumbers rank sequentially over the kept items', () => {
    const entries = [
      { title: 'a', url: 'u1', feed: { title: 'lwn' } },
      { title: 'skip', url: 'u2', feed: { title: 'unknown' } },
      { title: 'b', url: 'u3', feed: { title: 'simon-willison' } },
    ];
    const items = normalizeEntries(entries, KNOWN);
    expect(items.map((i) => i.rank)).toEqual([1, 2]);
  });
});

// 2026-09-10 DNS outage: 43 feeds hit parsing_error_count=3, Miniflux stopped
// polling them (checked_at frozen), the entries pull shrank to 25 over 18 days
// and collect still reported ok. These pin the check that would have said so.
describe('assessFeedHealth', () => {
  const NOW = Date.parse('2026-09-29T00:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
  const feed = (title, extra = {}) => ({
    title,
    parsing_error_count: 0,
    parsing_error_message: '',
    checked_at: hoursAgo(1),
    disabled: false,
    ...extra,
  });

  it('passes fresh feeds and tolerates a single failed poll', () => {
    const feeds = [feed('lwn'), feed('simon-willison', { parsing_error_count: 1 })];
    expect(assessFeedHealth(feeds, KNOWN, NOW)).toEqual({ total: 2, unhealthy: [] });
  });

  it('flags stalled (frozen checked_at), erroring, disabled and missing feeds', () => {
    const known = new Set(['a', 'b', 'c', 'd']);
    const feeds = [
      feed('a', { checked_at: hoursAgo(18 * 24), parsing_error_count: 3 }),
      feed('b', { parsing_error_count: 4, parsing_error_message: 'network error' }),
      feed('c', { disabled: true }),
      feed('not-in-scope', { disabled: true }),
    ];
    const { total, unhealthy } = assessFeedHealth(feeds, known, NOW);
    expect(total).toBe(4);
    expect(unhealthy.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'stalled'],
      ['b', 'erroring'],
      ['c', 'disabled'],
      ['d', 'missing'],
    ]);
    expect(unhealthy[1]).toMatchObject({ errors: 4, message: 'network error' });
  });

  it('treats a missing or unparseable checked_at as stalled', () => {
    const feeds = [feed('lwn', { checked_at: null })];
    const { unhealthy } = assessFeedHealth(feeds, new Set(['lwn']), NOW);
    expect(unhealthy[0].reason).toBe('stalled');
  });
});

describe('feedHealthNote', () => {
  it('is null when every feed is healthy', () => {
    expect(feedHealthNote({ total: 49, unhealthy: [] })).toBeNull();
  });

  it('names at most five feeds and counts the rest', () => {
    const unhealthy = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, reason: 'stalled' }));
    expect(feedHealthNote({ total: 49, unhealthy })).toBe(
      'miniflux-feeds (7/49 unhealthy: f0 stalled, f1 stalled, f2 stalled, f3 stalled, f4 stalled, +2 more)',
    );
  });
});

describe('fetchMinifluxFeedHealth', () => {
  afterEach(() => vi.unstubAllGlobals());
  const opts = { baseUrl: 'http://mf', authHeaders: { 'X-Auth-Token': 't' }, knownSources: KNOWN };

  it('reads /v1/feeds and returns an assessment the staging schema accepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { title: 'lwn', parsing_error_count: 0, checked_at: new Date().toISOString() },
        { title: 'simon-willison', parsing_error_count: 3, checked_at: '2026-09-10T00:00:00Z' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchMinifluxFeedHealth(opts);
    expect(fetchMock.mock.calls[0][0]).toBe('http://mf/v1/feeds');
    expect(r.ok).toBe(true);
    expect(r.unhealthy.map((u) => u.id)).toEqual(['simon-willison']);
    // collect writes this object verbatim into metadata.json.
    expect(() =>
      StagingMetadataSchema.parse({
        date: '2026-09-29',
        collected_at: 'x',
        timezone: 'Asia/Taipei',
        sources: {
          feeds: { ok: true, count: 1 },
          trending: { ok: true, count: 1 },
          search: { ok: true, count: 1 },
          developers: { ok: true, count: 1 },
        },
        miniflux_feed_health: r,
      }),
    ).not.toThrow();
  });

  it('fails soft on an HTTP error or a thrown fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    expect(await fetchMinifluxFeedHealth(opts)).toEqual({ ok: false, error: 'HTTP 502' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await fetchMinifluxFeedHealth(opts)).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });
});
