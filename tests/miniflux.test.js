import { describe, expect, it } from 'vitest';
import { normalizeEntries } from '../src/fetchers/miniflux.js';

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
