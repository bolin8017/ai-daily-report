import { afterEach, describe, expect, it, vi } from 'vitest';
import { hnFirebaseProvider } from '../src/fetchers/providers/hn-firebase.js';

describe('hn-firebase provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches list IDs then story details', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => {
        calls.push(url);
        if (url.includes('topstories.json')) {
          return { ok: true, json: () => Promise.resolve([100, 101, 102]) };
        }
        const id = url.match(/item\/(\d+)\.json/)[1];
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: Number(id),
              title: `Story ${id}`,
              url: `https://example.com/${id}`,
              by: 'pg',
              time: 1747900000,
              score: 42,
              descendants: 5,
            }),
        };
      }),
    );

    const result = await hnFirebaseProvider(
      { list: 'topstories', limit: 3 },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].hn_id).toBe('100');
    expect(result.items[0].score).toBe(42);
  });

  it('returns ok:false if list fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await hnFirebaseProvider(
      { list: 'topstories' },
      { itemType: 'hn-story', sourceId: 'hackernews' },
    );
    expect(result.ok).toBe(false);
  });
});
