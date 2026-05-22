import { afterEach, describe, expect, it, vi } from 'vitest';
import { rsshubProvider } from '../src/fetchers/providers/rsshub.js';

describe('rsshub provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns ok with items on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: '12345',
                title: 'Show HN: a thing',
                url: 'https://news.ycombinator.com/item?id=12345',
                content_html: '<a href="https://example.com">Source</a>',
                date_published: '2026-05-22T00:00:00Z',
                authors: [{ name: 'pg' }],
              },
            ],
          }),
      }),
    );

    const result = await rsshubProvider(
      { route: '/hackernews/show', normalize: 'hackernews', urls: ['https://rsshub.test'] },
      { itemType: 'hn-story', sourceId: 'hn-show' },
    );
    expect(result.ok).toBe(true);
    expect(result.items[0].hn_id).toBe('12345');
  });

  it('falls through to second URL on 5xx', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => {
        calls.push(url);
        if (url.startsWith('https://a.test')) {
          return { ok: false, status: 502 };
        }
        return { ok: true, json: () => Promise.resolve({ items: [] }) };
      }),
    );

    const result = await rsshubProvider(
      { route: '/x', urls: ['https://a.test', 'https://b.test'] },
      { itemType: 'rss-post', sourceId: 's' },
    );
    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
  });

  it('does NOT retry on 4xx', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => {
        calls.push(url);
        return { ok: false, status: 404 };
      }),
    );

    const result = await rsshubProvider(
      { route: '/x', urls: ['https://a.test', 'https://b.test'] },
      { itemType: 'rss-post', sourceId: 's' },
    );
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
  });
});
