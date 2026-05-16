// Tests for src/lib/scope.js — tagging staging items with their visible scope.

import { describe, expect, it } from 'vitest';
import { mergeOverlaySources } from '../src/lib/config.js';
import { tagItemScope } from '../src/lib/scope.js';

const phisonLensConfig = [
  { id: 'ai-builder', sources_overlay: {} },
  {
    id: 'phison-aidaptiv',
    sources_overlay: {
      feeds: [
        {
          type: 'rss',
          name: 'Phison Blog',
          url: 'https://phisonblog.com/feed/',
          category: 'phison',
          limit: 10,
        },
      ],
      github_topics: { topics: ['kv-cache', 'local-llm'] },
    },
  },
];

describe('tagItemScope', () => {
  it('tags global RSS items with scope=["global"]', () => {
    const item = {
      source: 'Hacker News',
      title: 'whatever',
      url: 'https://news.ycombinator.com/',
    };
    const tagged = tagItemScope(item, phisonLensConfig);
    expect(tagged._scope).toEqual(['global']);
  });

  it('tags Phison-overlay RSS items with both scopes', () => {
    const item = {
      source: 'Phison Blog',
      title: 'phison announces something',
      url: 'https://phisonblog.com/post/',
    };
    const tagged = tagItemScope(item, phisonLensConfig);
    expect(tagged._scope).toContain('global');
    expect(tagged._scope).toContain('phison-aidaptiv');
  });

  it('tags github-search items by topic match', () => {
    const item = { source: 'github-search', topic: 'kv-cache', name: 'cool-kvcache-thing' };
    const tagged = tagItemScope(item, phisonLensConfig);
    expect(tagged._scope).toContain('phison-aidaptiv');
  });

  it('items not matching any overlay get global-only', () => {
    const item = { source: 'github-search', topic: 'rag', name: 'rag-thing' };
    const tagged = tagItemScope(item, phisonLensConfig);
    expect(tagged._scope).toEqual(['global']);
  });

  it('handles empty / null lenses list', () => {
    const item = { source: 'whatever', title: 'x' };
    expect(tagItemScope(item, [])._scope).toEqual(['global']);
    expect(tagItemScope(item, null)._scope).toEqual(['global']);
  });
});

describe('mergeOverlaySources', () => {
  const base = {
    sources: {
      rsshub_urls: ['https://rsshub.example/'],
      feeds: [{ type: 'rss', name: 'A', url: 'https://a/', category: 'x', limit: 5 }],
      github_topics: { enabled: true, topics: ['rag'], limit_per_topic: 10 },
      github_developers: {
        enabled: false,
        global_limit: 1,
        global_min_followers: 1,
        regions: [],
        new_repo_window_hours: 24,
      },
    },
    lenses: [
      {
        id: 'phison',
        enabled: true,
        sources_overlay: {
          feeds: [
            // duplicate of global A — should not be added twice
            { type: 'rss', name: 'A', url: 'https://a/', category: 'x', limit: 5 },
            // new feed — should be added
            { type: 'rss', name: 'B', url: 'https://b/', category: 'phison', limit: 5 },
          ],
          github_topics: { topics: ['rag', 'kv-cache'] },
        },
      },
    ],
    report: { language: 'zh-TW', max_featured_items: 12, style: 'creative' },
  };

  it('appends overlay feeds without duplicating global ones', () => {
    const merged = mergeOverlaySources(base);
    expect(merged.sources.feeds.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('appends overlay topics without duplicating global ones', () => {
    const merged = mergeOverlaySources(base);
    expect(merged.sources.github_topics.topics).toEqual(['rag', 'kv-cache']);
  });

  it('skips disabled lenses', () => {
    const config = structuredClone(base);
    config.lenses[0].enabled = false;
    const merged = mergeOverlaySources(config);
    expect(merged.sources.feeds.map((f) => f.name)).toEqual(['A']);
    expect(merged.sources.github_topics.topics).toEqual(['rag']);
  });

  it('returns a new object (does not mutate input)', () => {
    const config = structuredClone(base);
    const before = config.sources.feeds.length;
    mergeOverlaySources(config);
    expect(config.sources.feeds.length).toBe(before);
  });
});
