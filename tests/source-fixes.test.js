import { describe, expect, it, vi } from 'vitest';
import { extractArxivPaper } from '../src/fetchers/providers/_extractors/arxiv-paper.js';
// Importing rsshub.js registers the wrapped 'rsshub' provider in the registry.
import { defineProvider, getProvider } from '../src/fetchers/providers/_registry.js';
import { arxivRssProvider } from '../src/fetchers/providers/arxiv-rss.js';
import '../src/fetchers/providers/rsshub.js';
import { runChain } from '../src/fetchers/run-chain.js';
import baseRegistry from '../src/sources/registry.js';

// Regression suite for the 2026-06-07 production-run source degradations:
//   hf-daily-papers (rsshub normalizer ↔ arxiv-paper schema mismatch),
//   arxiv-cs-ai     (tier-0 429 rate-limit + tier-1 extractor format),
//   mops-disclosure (low-frequency weekend-empty mis-flagged degraded).
// Every test exercises real production code, not hand-built fixtures.
describe('source fixes (2026-06-07 degradations)', () => {
  describe('hf-daily-papers: rsshub produces schema-valid arxiv-paper items', () => {
    it('normalizes HF daily-papers feed items and passes arxiv-paper validation', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  title: 'Scaling Language Models via Sparse Mixture of Experts',
                  url: 'https://huggingface.co/papers/2501.04906',
                  content_text: 'A sparse mixture-of-experts approach for LLMs.',
                  date_published: '2025-01-10T00:00:00Z',
                  authors: [{ name: 'Jane Smith' }, { name: 'John Doe' }],
                },
              ],
            }),
        }),
      );

      // The WRAPPED provider validates each item against the arxiv-paper schema —
      // this is exactly the gate that rejected all 30 items in production.
      const provider = getProvider('rsshub');
      const res = await provider(
        { route: '/huggingface/daily-papers', urls: ['https://rsshub.test'] },
        { itemType: 'arxiv-paper', sourceId: 'hf-daily-papers' },
      );

      expect(res.ok).toBe(true);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].paper_id).toBe('2501.04906');
      expect(res.items[0].url).toBe('https://arxiv.org/abs/2501.04906');
      expect(res.items[0].abstract).toContain('mixture-of-experts');
      expect(res.items[0].authors).toEqual(['Jane Smith', 'John Doe']);
      vi.restoreAllMocks();
    });
  });

  describe('arxiv-cs-ai: extractArxivPaper handles both HF and arxiv-listing markdown', () => {
    it('extracts from HuggingFace daily-papers markdown', () => {
      const md = `
### [Scaling Language Models via Sparse Mixture of Experts](https://huggingface.co/papers/2501.04906)

By Jane Smith, John Doe
`;
      const items = extractArxivPaper(md);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].paper_id).toBe('2501.04906');
      expect(items[0].url).toBe('https://arxiv.org/abs/2501.04906');
    });

    it('extracts from arxiv.org/list listing markdown (the tier-1 jina fallback)', () => {
      const md = `
## cs.LG (Machine Learning)

1. [2501.04906](https://arxiv.org/abs/2501.04906) Scaling Language Models via Sparse MoE
2. [2501.04905](https://arxiv.org/abs/2501.04905) Efficient Transformers for Long Sequences
`;
      const items = extractArxivPaper(md);
      expect(items.map((i) => i.paper_id)).toEqual(['2501.04906', '2501.04905']);
      expect(items.every((i) => /arxiv\.org\/abs/.test(i.url))).toBe(true);
    });
  });

  describe('arxiv-cs-ai: tier-0 arxiv API 429 retry-with-backoff', () => {
    const parsed = {
      items: [
        {
          title: 'A Paper',
          summary: 'abstract',
          link: 'https://arxiv.org/abs/2501.00001',
          authors: [],
          categories: ['cs.LG'],
          isoDate: '2026-06-07T00:00:00Z',
        },
      ],
    };

    it('retries on a 429 and recovers on the next attempt', async () => {
      let calls = 0;
      const fakeFetch = vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('Status code 429');
        return parsed;
      });
      const res = await arxivRssProvider(
        { keywords: ['kv cache'], maxResults: 5 },
        { _fetchFeed: fakeFetch, _sleep: () => Promise.resolve() },
      );
      expect(res.ok).toBe(true);
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });

    it('gives up after exhausting retries on a persistent 429', async () => {
      const fakeFetch = vi.fn(async () => {
        throw new Error('Status code 429');
      });
      const res = await arxivRssProvider(
        { keywords: ['kv cache'] },
        { _fetchFeed: fakeFetch, _sleep: () => Promise.resolve() },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/429/);
      expect(fakeFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('does NOT retry a non-retryable error', async () => {
      const fakeFetch = vi.fn(async () => {
        throw new Error('ENOTFOUND export.arxiv.org');
      });
      const res = await arxivRssProvider(
        { keywords: ['kv cache'] },
        { _fetchFeed: fakeFetch, _sleep: () => Promise.resolve() },
      );
      expect(res.ok).toBe(false);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('mops-disclosure: threshold 0 keeps a successful empty fetch healthy', () => {
    it('the registry declares threshold 0 for mops-disclosure', () => {
      const mops = baseRegistry.find((s) => s.id === 'mops-disclosure');
      expect(mops).toBeDefined();
      expect(mops.threshold).toBe(0);
    });

    it('runChain with threshold 0 treats a fetched-but-empty result as healthy (tier_used 0)', async () => {
      // Weekend / market-closed: the provider succeeds but matches no watchlist
      // disclosures. With threshold 0 this is healthy, not a chain failure.
      defineProvider('mops-empty-test', async () => ({ ok: true, items: [] }));
      const source = {
        id: 'mops-disclosure',
        itemType: 'mops-disclosure',
        threshold: 0,
        chain: [{ provider: 'mops-empty-test', config: {} }],
      };
      const res = await runChain(source, { telemetry: { record: vi.fn() } });
      expect(res.ok).toBe(true);
      expect(res.tier_used).toBe(0);
      expect(res.items).toEqual([]);
    });

    it('a genuine fetch failure still fails even with threshold 0', async () => {
      // threshold 0 must NOT mask a real provider error (both MOPS venues down).
      defineProvider('mops-fail-test', async () => ({
        ok: false,
        items: [],
        error: 'both venues down',
      }));
      const source = {
        id: 'mops-disclosure',
        itemType: 'mops-disclosure',
        threshold: 0,
        chain: [{ provider: 'mops-fail-test', config: {} }],
      };
      const res = await runChain(source, { telemetry: { record: vi.fn() } });
      expect(res.ok).toBe(false);
      expect(res.tier_used).toBe(-1);
    });
  });
});
