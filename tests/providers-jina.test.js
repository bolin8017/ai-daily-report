import { afterEach, describe, expect, it, vi } from 'vitest';
import { jinaReaderProvider } from '../src/fetchers/providers/jina-reader.js';

describe('jina-reader provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JINA_DISABLED;
  });

  it('fetches r.jina.ai URL and runs extractor for itemType', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            `1.[](https://news.ycombinator.com/vote?id=4242&how=up)[Test Story](https://example.com/x) 5 points by [alice](...)[2 hours ago](https://news.ycombinator.com/item?id=4242)`,
          ),
      }),
    );
    const result = await jinaReaderProvider(
      { url: 'https://news.ycombinator.com' },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(true);
    expect(result.items[0].hn_id).toBe('4242');
  });

  it('returns ok:false when extractor yields nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not a hn page'),
      }),
    );
    const result = await jinaReaderProvider(
      { url: 'https://x.test' },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(false);
  });

  it('returns ok:false on http error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await jinaReaderProvider(
      { url: 'https://x.test' },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(false);
  });

  it('returns ok:false when JINA_DISABLED', async () => {
    process.env.JINA_DISABLED = '1';
    const result = await jinaReaderProvider(
      { url: 'https://x.test' },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('disabled');
  });

  it('returns ok:false for unsupported itemType', async () => {
    const result = await jinaReaderProvider(
      { url: 'https://x.test' },
      { itemType: 'mops-disclosure', sourceId: 'm' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no jina extractor/);
  });
});
