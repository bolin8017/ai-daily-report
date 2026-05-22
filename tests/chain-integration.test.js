// End-to-end chain integration test: stubs every provider in the source
// registry and verifies every source resolves OK through runAll.

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearProviders, defineProvider } from '../src/fetchers/providers/_registry.js';

// Side-effect imports populate the provider registry; we then clear and stub.
import '../src/fetchers/providers/arxiv-rss.js';
import '../src/fetchers/providers/firecrawl.js';
import '../src/fetchers/providers/github-developers-api.js';
import '../src/fetchers/providers/github-developers-html.js';
import '../src/fetchers/providers/github-search-api.js';
import '../src/fetchers/providers/github-trending-html.js';
import '../src/fetchers/providers/hf-trending-json.js';
import '../src/fetchers/providers/hn-firebase.js';
import '../src/fetchers/providers/jina-reader.js';
import '../src/fetchers/providers/leaderboard-html.js';
import '../src/fetchers/providers/lobsters-json.js';
import '../src/fetchers/providers/mops-twse-openapi.js';
import '../src/fetchers/providers/native-json.js';
import '../src/fetchers/providers/native-rss.js';
import '../src/fetchers/providers/rsshub.js';

import { runAll } from '../src/fetchers/run-all.js';
import sources from '../src/sources/registry.js';

const STUBS = {
  'hn-story': {
    source: 'hackernews',
    title: 't',
    url: 'https://x.test',
    hn_url: 'https://news.ycombinator.com/item?id=1',
    hn_id: '1',
    author: '',
    published: null,
    rank: 1,
  },
  'rss-post': {
    source: 's',
    category: 'c',
    title: 't',
    url: 'https://x.test',
    published: null,
    rank: 1,
  },
  'repo-card': {
    full_name: 'a/b',
    url: 'https://github.com/a/b',
    description: null,
    language: null,
    stars: 0,
    rank: 1,
  },
  'arxiv-paper': {
    paper_id: '2401.00001',
    url: 'https://arxiv.org/abs/2401.00001',
    title: 't',
    abstract: '',
    authors: [],
    categories: [],
    published: null,
  },
  'hf-model': {
    id: 'a/b',
    url: 'https://huggingface.co/a/b',
    downloads: null,
    likes: null,
    last_modified: null,
    tags: [],
    pipeline_tag: null,
  },
  'mops-disclosure': {
    ticker: '8299',
    ticker_name: '群聯',
    disclosure_date: null,
    statement_date: null,
    statement_time: null,
    headline: 'h',
    basis: null,
    fact_date: null,
    detail: '',
    url: 'https://mops.twse.com.tw/mops/web/t05st01?co_id=8299',
  },
  'leaderboard-entry': {
    bench: 'bfcl',
    fetched_at: new Date().toISOString(),
    top_5_today: ['a'],
    new_top_5: [],
    rank_changes: [],
  },
};

describe('full chain integration (stubbed providers)', () => {
  it('all 39 registered sources resolve OK through runAll', async () => {
    clearProviders();
    const providerNames = new Set(sources.flatMap((s) => s.chain.map((c) => c.provider)));
    // Return 30 stub items so HN sources (threshold 10/5) also pass
    for (const name of providerNames) {
      defineProvider(name, async (_cfg, ctx) => ({
        ok: true,
        items: Array.from({ length: 30 }, (_, i) => ({
          ...STUBS[ctx.itemType],
          rank: i + 1,
          ...(ctx.itemType === 'hn-story'
            ? {
                hn_id: String(i + 1),
                hn_url: `https://news.ycombinator.com/item?id=${i + 1}`,
              }
            : {}),
        })),
      }));
    }

    const dir = await mkdtemp(join(tmpdir(), 'ci-'));
    process.env.FIRECRAWL_DISABLED = '1';
    const { healthy } = await runAll(sources, {
      telemetryDir: dir,
      date: '2026-05-22',
      minHealthy: 1,
    });
    expect(healthy.length).toBe(sources.length);

    const tel = JSON.parse(await readFile(join(dir, '2026-05-22.json'), 'utf8'));
    expect(tel.summary.sources_healthy + tel.summary.sources_degraded).toBe(sources.length);
    delete process.env.FIRECRAWL_DISABLED;
  });
});
