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

  // The fastvideo feed existed before its rule did, so creation-time attributes
  // alone would never reach it: the rule must be reconciled on existing feeds.
  describe('block_filter_entry_rules reconcile', () => {
    const rule = 'EntryTitle=(?i)^\\[bugfix\\]';
    const cats = [{ id: 1, title: 'tech' }];
    const want = [
      { id: 'fv', url: 'https://fv.com/feed', category: 'tech', blockFilterEntryRules: rule },
    ];

    it('carries the rule into the create plan for a new feed', () => {
      const plan = planMinifluxSync({
        opmlFeeds: want,
        existingFeeds: [],
        existingCategories: cats,
      });
      expect(plan.createFeeds[0].blockFilterEntryRules).toBe(rule);
      expect(plan.updateFeeds).toEqual([]);
    });

    it('plans an update when an existing feed lacks the rule', () => {
      const plan = planMinifluxSync({
        opmlFeeds: want,
        existingFeeds: [{ id: 45, feed_url: 'https://fv.com/feed/', block_filter_entry_rules: '' }],
        existingCategories: cats,
      });
      expect(plan.createFeeds).toEqual([]);
      expect(plan.updateFeeds).toEqual([{ id: 45, source: 'fv', block_filter_entry_rules: rule }]);
    });

    it('is a no-op once the existing feed carries the same rule', () => {
      const plan = planMinifluxSync({
        opmlFeeds: want,
        existingFeeds: [
          { id: 45, feed_url: 'https://fv.com/feed', block_filter_entry_rules: rule },
        ],
        existingCategories: cats,
      });
      expect(plan.updateFeeds).toEqual([]);
    });

    it('clears a rule the OPML no longer declares', () => {
      const plan = planMinifluxSync({
        opmlFeeds: [{ id: 'fv', url: 'https://fv.com/feed', category: 'tech' }],
        existingFeeds: [
          { id: 45, feed_url: 'https://fv.com/feed', block_filter_entry_rules: rule },
        ],
        existingCategories: cats,
      });
      expect(plan.updateFeeds).toEqual([{ id: 45, source: 'fv', block_filter_entry_rules: '' }]);
    });

    it('reaches a redirected feed through its source-id title', () => {
      const plan = planMinifluxSync({
        opmlFeeds: want,
        existingFeeds: [
          { id: 46, feed_url: 'https://moved.com/feed', title: 'fv', block_filter_entry_rules: '' },
        ],
        existingCategories: cats,
      });
      expect(plan.updateFeeds).toEqual([{ id: 46, source: 'fv', block_filter_entry_rules: rule }]);
    });

    it('treats a missing field (older Miniflux) as no rule', () => {
      const plan = planMinifluxSync({
        opmlFeeds: [{ id: 'fv', url: 'https://fv.com/feed', category: 'tech' }],
        existingFeeds: [{ id: 45, feed_url: 'https://fv.com/feed' }],
        existingCategories: cats,
      });
      expect(plan.updateFeeds).toEqual([]);
    });
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
    expect(plan.updateFeeds).toEqual([]);
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
