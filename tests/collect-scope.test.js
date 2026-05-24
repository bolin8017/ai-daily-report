// Tests for src/lib/scope.js — tagging staging items with their visible scope.

import { describe, expect, it } from 'vitest';
import { tagItemScope } from '../src/lib/scope.js';

// Mirrors what loadTheme('ai-builder').sources would return, scoped to the
// phison_overlay block tagItemScope cares about.
const aiBuilderTheme = {
  name: 'ai-builder',
  sources: {
    phison_overlay: {
      enabled: true,
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
};

describe('tagItemScope', () => {
  it('tags items from global sources with scope=["global"]', () => {
    const item = {
      source: 'hackernews',
      title: 'whatever',
      url: 'https://news.ycombinator.com/',
    };
    const tagged = tagItemScope(item, aiBuilderTheme);
    expect(tagged._scope).toEqual(['global']);
  });

  it('tags overlay-source items with theme name in addition to global', () => {
    const item = {
      source: 'phison-blog',
      title: 'phison announces something',
      url: 'https://phisonblog.com/post/',
    };
    const tagged = tagItemScope(item, aiBuilderTheme);
    expect(tagged._scope).toContain('global');
    expect(tagged._scope).toContain('ai-builder');
  });

  it('tags github-search items by topic match', () => {
    const item = { source: 'github-search', topic: 'kv-cache', name: 'cool-kvcache-thing' };
    const tagged = tagItemScope(item, aiBuilderTheme);
    expect(tagged._scope).toContain('ai-builder');
  });

  it('items not matching any overlay get global-only', () => {
    const item = { source: 'github-search', topic: 'rag', name: 'rag-thing' };
    const tagged = tagItemScope(item, aiBuilderTheme);
    expect(tagged._scope).toEqual(['global']);
  });

  it('handles missing / null theme gracefully', () => {
    const item = { source: 'whatever', title: 'x' };
    expect(tagItemScope(item, null)._scope).toEqual(['global']);
    expect(tagItemScope(item, undefined)._scope).toEqual(['global']);
    expect(tagItemScope(item, { sources: {} })._scope).toEqual(['global']);
  });
});
