import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/interests.js', () => ({
  loadInterests: vi.fn(async () => {
    throw new Error('boom');
  }),
  arxivKeywords: vi.fn(),
}));

describe('arxivRssProvider interests-load failure', () => {
  it('degrades to ok:false when loadInterests throws', async () => {
    const { arxivRssProvider } = await import('../src/fetchers/providers/arxiv-rss.js');
    const res = await arxivRssProvider({}, {}); // no cfg.keywords → hits loadInterests path
    expect(res.ok).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.error).toMatch(/interests load failed/);
  });
});
