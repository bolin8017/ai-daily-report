// Tests for src/lib/scope.js — tagging staging items with their visible scope.

import { describe, expect, it } from 'vitest';
import { tagItemScope } from '../src/lib/scope.js';

const phisonLensConfig = [
  { id: 'ai-builder', sources_overlay: {} },
  {
    id: 'phison-aidaptiv',
    sources_overlay: {
      sources: [
        {
          id: 'phison-blog',
          label: 'Phison Blog',
          category: 'phison-vendor',
          itemType: 'rss-post',
          chain: [{ provider: 'native-rss', config: { url: 'https://phisonblog.com/feed/' } }],
        },
      ],
      github_topics: { topics: ['kv-cache', 'local-llm'] },
    },
  },
];

describe('tagItemScope', () => {
  it('tags items from global sources with scope=["global"]', () => {
    const item = {
      source: 'hackernews',
      title: 'whatever',
      url: 'https://news.ycombinator.com/',
    };
    const tagged = tagItemScope(item, phisonLensConfig);
    expect(tagged._scope).toEqual(['global']);
  });

  it('tags lens-overlay items with both scopes', () => {
    const item = {
      source: 'phison-blog',
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
