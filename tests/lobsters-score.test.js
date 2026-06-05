import { describe, expect, it, vi } from 'vitest';

describe('lobsters-json provider maps upstream score', () => {
  it('passes item.score through to the normalized item', async () => {
    const fake = [
      {
        title: 'A',
        url: 'https://a.example',
        short_id: 'a1',
        score: 42,
        tags: [],
        created_at: '2026-06-04T00:00:00Z',
        submitter_user: { username: 'x' },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => fake })),
    );
    const mod = await import('../src/fetchers/providers/lobsters-json.js');
    const res = await mod.lobstersJSONProvider(
      { url: 'https://lobste.rs/hottest.json', limit: 15 },
      {},
    );
    vi.unstubAllGlobals();
    expect(res.ok).toBe(true);
    expect(res.items[0].score).toBe(42);
  });
});
