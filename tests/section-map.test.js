import { describe, expect, it } from 'vitest';
import { buildSectionMap, loadSectionMap } from '../src/lib/section-map.js';

describe('section-map', () => {
  it('routes by category', () => {
    const m = buildSectionMap([
      { id: 'hackernews', category: 'community', itemType: 'hn-story' },
      { id: 'anthropic-news', category: 'AI 公司', itemType: 'rss-post' },
    ]);
    expect(m.sectionsForSource('hackernews')).toEqual(['pulse']);
    expect(m.sectionsForSource('anthropic-news')).toEqual(['tech']);
  });

  it('per-source override wins over category and can be multi-section', () => {
    const m = buildSectionMap([{ id: 'ithome', category: '台灣媒體', itemType: 'rss-post' }]);
    expect(m.sectionsForSource('ithome')).toEqual(['pulse', 'market']);
  });

  it('unknown source → no sections', () => {
    const m = buildSectionMap([]);
    expect(m.sectionsForSource('nope')).toEqual([]);
  });

  it('sourcesForSection lists every id mapped to a section', () => {
    const m = buildSectionMap([
      { id: 'hackernews', category: 'community', itemType: 'hn-story' },
      { id: 'lobsters', category: 'community', itemType: 'rss-post' },
    ]);
    expect(m.sourcesForSection('pulse').sort()).toEqual(['hackernews', 'lobsters']);
  });

  it('sourcesForSection includes a source routed via a multi-section override', () => {
    const m = buildSectionMap([
      { id: 'ithome', category: '台灣媒體', itemType: 'rss-post' },
      { id: 'techcrunch-venture', category: 'market', itemType: 'rss-post' },
    ]);
    expect(m.sourcesForSection('market').sort()).toEqual(['ithome', 'techcrunch-venture']);
    expect(m.sourcesForSection('pulse')).toEqual(['ithome']);
  });

  it('REAL registry: no feed source is orphaned (maps to ≥1 section)', async () => {
    const m = await loadSectionMap();
    expect(m.orphans()).toEqual([]);
  });
});
