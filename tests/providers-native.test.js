import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeJSONProvider } from '../src/fetchers/providers/native-json.js';
import { nativeRSSProvider } from '../src/fetchers/providers/native-rss.js';

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item>
    <title>Post One</title>
    <link>https://example.com/1</link>
    <pubDate>Mon, 22 May 2026 00:00:00 GMT</pubDate>
    <description>Body of post one</description>
  </item>
</channel></rss>`;

describe('native providers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('native-rss parses RSS XML and yields rss-post items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(RSS_XML),
      }),
    );
    const result = await nativeRSSProvider(
      { url: 'https://x.test/feed', sourceName: 'test', category: 'AI 部落格' },
      { itemType: 'rss-post', sourceId: 'test' },
    );
    expect(result.ok).toBe(true);
    expect(result.items[0].title).toBe('Post One');
    expect(result.items[0].source).toBe('test');
  });

  it('native-rss sends a per-source User-Agent when one is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS_XML) });
    vi.stubGlobal('fetch', fetchMock);
    await nativeRSSProvider(
      { url: 'https://x.test/feed', sourceName: 't', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
      { itemType: 'rss-post', sourceId: 't' },
    );
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(
      'Mozilla/5.0 (X11; Linux x86_64)',
    );
  });

  it('native-rss returns ok:false on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const result = await nativeRSSProvider(
      { url: 'https://x.test/feed', sourceName: 't' },
      { itemType: 'rss-post', sourceId: 't' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/403/);
  });

  it('native-json parses array endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { title: 'A', link: 'https://example.com/a', isoDate: '2026-05-22T00:00:00Z' },
          ]),
      }),
    );
    const result = await nativeJSONProvider(
      { url: 'https://api.test/list', sourceName: 's', category: 'c' },
      { itemType: 'rss-post', sourceId: 's' },
    );
    expect(result.ok).toBe(true);
    expect(result.items[0].title).toBe('A');
  });
});
