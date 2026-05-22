import { afterEach, describe, expect, it, vi } from 'vitest';
import { lobstersJSONProvider } from '../src/fetchers/providers/lobsters-json.js';

describe('lobsters-json provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes lobsters api response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              short_id: 'abc',
              title: 'A post',
              url: 'https://example.com/a',
              comments_url: 'https://lobste.rs/s/abc',
              submitter_user: { username: 'alice' },
              score: 10,
              comment_count: 3,
              tags: ['programming'],
              created_at: '2026-05-22T00:00:00Z',
            },
          ]),
      }),
    );

    const result = await lobstersJSONProvider(
      { url: 'https://lobste.rs/hottest.json' },
      { itemType: 'rss-post', sourceId: 'lobsters' },
    );
    expect(result.ok).toBe(true);
    expect(result.items[0].source).toBe('lobsters');
    expect(result.items[0].title).toBe('A post');
  });
});
