import { describe, expect, it, vi } from 'vitest';
import {
  arxivRssProvider,
  buildArxivSearchQuery,
  parseArxivEntries,
} from '../src/fetchers/providers/arxiv-rss.js';

describe('buildArxivSearchQuery', () => {
  it('ORs quoted keywords across abstract and ANDs the cs.* categories', () => {
    const q = buildArxivSearchQuery(['kv cache', 'retrieval']);
    expect(q).toContain('abs:%22kv+cache%22');
    expect(q).toContain('abs:retrieval');
    expect(q).toContain('+OR+');
    expect(q).toContain('+AND+');
    expect(q).toMatch(/cat:cs\.(AI|CL|LG|IR)/);
  });
  it('caps the number of keywords to keep the query bounded', () => {
    const many = Array.from({ length: 80 }, (_, i) => `kw${i}`);
    const q = buildArxivSearchQuery(many, { maxKeywords: 40 });
    expect((q.match(/abs:/g) || []).length).toBe(40);
  });
  it('returns null for an empty keyword list', () => {
    expect(buildArxivSearchQuery([])).toBeNull();
  });
});

describe('parseArxivEntries', () => {
  it('maps Atom entries to the arxiv item shape and truncates the abstract', () => {
    const parsed = {
      items: [
        {
          title: '  A  Title ',
          summary: 'x'.repeat(500),
          link: 'https://arxiv.org/abs/2406.00001',
          authors: [{ name: 'Jane Doe' }],
          categories: ['cs.LG'],
          isoDate: '2026-06-05T00:00:00Z',
        },
      ],
    };
    const items = parseArxivEntries(parsed);
    expect(items[0].paper_id).toBe('2406.00001');
    expect(items[0].title).toBe('A Title');
    expect(items[0].abstract.length).toBeLessThanOrEqual(403);
    expect(items[0].abstract.endsWith('...')).toBe(true);
    expect(items[0].url).toBe('https://arxiv.org/abs/2406.00001');
    expect(items[0].published).toBe('2026-06-05T00:00:00Z');
    expect(items[0].authors).toEqual(['Jane Doe']);
  });
});

describe('arxivRssProvider (topic-locked)', () => {
  it('builds a keyword query, fetches the search API, returns capped mapped items', async () => {
    const parsed = {
      items: Array.from({ length: 50 }, (_, i) => ({
        title: `P${i}`,
        summary: 'abc',
        link: `https://arxiv.org/abs/2406.${String(i).padStart(5, '0')}`,
        authors: [],
        categories: ['cs.LG'],
        isoDate: '2026-06-05T00:00:00Z',
      })),
    };
    let capturedUrl;
    const fakeFetch = vi.fn(async (url) => {
      capturedUrl = url;
      return parsed;
    });
    const res = await arxivRssProvider(
      { keywords: ['kv cache', 'retrieval'], maxResults: 30 },
      { _fetchFeed: fakeFetch },
    );
    expect(res.ok).toBe(true);
    expect(res.items.length).toBe(30);
    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(capturedUrl).toContain('export.arxiv.org/api/query');
    expect(capturedUrl).toContain('search_query=');
  });

  it('degrades to ok:false items:[] when there are no keywords', async () => {
    const res = await arxivRssProvider({ keywords: [] }, {});
    expect(res.ok).toBe(false);
    expect(res.items).toEqual([]);
    expect(typeof res.error).toBe('string');
  });
});
