import { describe, expect, it } from 'vitest';
import { planMinifluxSync } from '../src/lib/miniflux-sync.js';

const opml = [
  { id: 'a', url: 'https://a.com/feed', category: 'pulse' },
  { id: 'b', url: 'https://b.com/feed', category: 'market' },
];

describe('planMinifluxSync', () => {
  it('creates missing categories and missing feeds', () => {
    const plan = planMinifluxSync({
      opmlFeeds: opml,
      existingFeeds: [{ feed_url: 'https://a.com/feed' }],
      existingCategories: [{ id: 1, title: 'pulse' }],
    });
    expect(plan.createCategories).toEqual(['market']);
    expect(plan.createFeeds).toEqual([
      { feed_url: 'https://b.com/feed', category: 'market', source: 'b' },
    ]);
  });

  // A feed whose outline declares a UA must be created WITH it: Miniflux's
  // default UA earns a 403 from Reddit, and the feed would then sit in the
  // instance looking provisioned while never returning an entry.
  it('carries a per-feed userAgent into the create plan', () => {
    const plan = planMinifluxSync({
      opmlFeeds: [
        { id: 'r', url: 'https://r.com/.rss', category: 'tech', userAgent: 'Mozilla/5.0' },
      ],
      existingFeeds: [],
      existingCategories: [{ id: 1, title: 'tech' }],
    });
    expect(plan.createFeeds).toEqual([
      { feed_url: 'https://r.com/.rss', category: 'tech', source: 'r', userAgent: 'Mozilla/5.0' },
    ]);
  });

  it('is a no-op when everything already exists (idempotent)', () => {
    const plan = planMinifluxSync({
      opmlFeeds: opml,
      existingFeeds: [{ feed_url: 'https://a.com/feed' }, { feed_url: 'https://b.com/feed' }],
      existingCategories: [
        { id: 1, title: 'pulse' },
        { id: 2, title: 'market' },
      ],
    });
    expect(plan.createCategories).toEqual([]);
    expect(plan.createFeeds).toEqual([]);
  });

  it('reports extra feeds in Miniflux not present in OPML (no auto-delete)', () => {
    const plan = planMinifluxSync({
      opmlFeeds: opml,
      existingFeeds: [{ feed_url: 'https://a.com/feed' }, { feed_url: 'https://gone.com/feed' }],
      existingCategories: [
        { id: 1, title: 'pulse' },
        { id: 2, title: 'market' },
      ],
    });
    expect(plan.orphanFeeds).toEqual(['https://gone.com/feed']);
  });
});
