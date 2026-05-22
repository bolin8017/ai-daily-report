import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firecrawlProvider } from '../src/fetchers/providers/firecrawl.js';

describe('firecrawl provider', () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'fc-test';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_DISABLED;
  });

  it('short-circuits when FIRECRAWL_DISABLED=1', async () => {
    process.env.FIRECRAWL_DISABLED = '1';
    const result = await firecrawlProvider(
      { url: 'https://x.test' },
      {
        itemType: 'hn-story',
        sourceId: 'hn',
        quota: { canSpend: vi.fn(), record: vi.fn() },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('disabled');
  });

  it('blocks when quota exhausted', async () => {
    const quota = {
      canSpend: vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: 'quota exhausted', remaining: 0 }),
      record: vi.fn(),
    };
    const result = await firecrawlProvider(
      { url: 'https://x.test' },
      { itemType: 'hn-story', sourceId: 'hn', quota },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quota/);
    expect(quota.record).not.toHaveBeenCalled();
  });

  it('records quota use on success', async () => {
    const quota = {
      canSpend: vi.fn().mockResolvedValue({ allowed: true, remaining: 100 }),
      record: vi.fn(),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              markdown:
                '1.[](https://news.ycombinator.com/vote?id=1&how=up)[Test](https://example.com/x) 5 points by [u](...)[1h](https://news.ycombinator.com/item?id=1)',
            },
          }),
      }),
    );
    const result = await firecrawlProvider(
      { url: 'https://news.ycombinator.com' },
      { itemType: 'hn-story', sourceId: 'hackernews', quota },
    );
    expect(result.ok).toBe(true);
    expect(quota.record).toHaveBeenCalledWith(1);
  });
});
