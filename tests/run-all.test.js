import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearProviders, defineProvider } from '../src/fetchers/providers/_registry.js';
import { runAll } from '../src/fetchers/run-all.js';

const hn = (rank) => ({
  source: 'hackernews',
  title: `t${rank}`,
  url: 'https://x.test',
  hn_url: `https://news.ycombinator.com/item?id=${rank}`,
  hn_id: String(rank),
  author: '',
  published: null,
  rank,
});

describe('runAll', () => {
  beforeEach(() => clearProviders());

  it('runs sources in parallel, aggregates results, writes telemetry', async () => {
    defineProvider('p-ok', async () => ({ ok: true, items: [hn(1), hn(2)] }));
    defineProvider('p-fail', async () => ({ ok: false, items: [], error: 'boom' }));

    const sources = [
      {
        id: 's1',
        label: 'S1',
        category: 'c',
        itemType: 'hn-story',
        chain: [{ provider: 'p-ok', config: {} }],
      },
      {
        id: 's2',
        label: 'S2',
        category: 'c',
        itemType: 'hn-story',
        chain: [{ provider: 'p-fail', config: {} }],
      },
    ];

    const dir = await mkdtemp(join(tmpdir(), 'ra-'));
    process.env.FIRECRAWL_DISABLED = '1';
    const result = await runAll(sources, {
      telemetryDir: dir,
      date: '2026-05-22',
      minHealthy: 1,
    });

    expect(result.results.s1.ok).toBe(true);
    expect(result.results.s2.ok).toBe(false);
    expect(result.healthy).toEqual(['s1']);
    expect(result.degraded).toEqual(['s2']);

    const tel = JSON.parse(await readFile(join(dir, '2026-05-22.json'), 'utf8'));
    expect(tel.summary.sources_total).toBe(2);
    delete process.env.FIRECRAWL_DISABLED;
  });

  it('throws when healthy count below threshold', async () => {
    defineProvider('p-fail', async () => ({ ok: false, items: [] }));
    const sources = [
      {
        id: 's1',
        label: 'S1',
        category: 'c',
        itemType: 'hn-story',
        chain: [{ provider: 'p-fail', config: {} }],
      },
      {
        id: 's2',
        label: 'S2',
        category: 'c',
        itemType: 'hn-story',
        chain: [{ provider: 'p-fail', config: {} }],
      },
    ];
    const dir = await mkdtemp(join(tmpdir(), 'ra-'));
    process.env.FIRECRAWL_DISABLED = '1';
    await expect(
      runAll(sources, { telemetryDir: dir, date: '2026-05-22', minHealthy: 1 }),
    ).rejects.toThrow(/healthy/);
    delete process.env.FIRECRAWL_DISABLED;
  });
});
