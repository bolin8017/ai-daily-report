import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearProviders, defineProvider } from '../src/fetchers/providers/_registry.js';
import { runChain } from '../src/fetchers/run-chain.js';

const makeHN = (rank) => ({
  source: 'hackernews',
  title: `t${rank}`,
  url: 'https://x.test',
  hn_url: `https://news.ycombinator.com/item?id=${rank}`,
  hn_id: String(rank),
  author: '',
  published: null,
  rank,
});

describe('runChain', () => {
  beforeEach(() => clearProviders());

  it('returns first tier that meets threshold', async () => {
    defineProvider('p1', async () => ({ ok: true, items: [makeHN(1), makeHN(2)] }));
    defineProvider('p2', async () => ({ ok: true, items: [makeHN(3)] }));
    const source = {
      id: 's',
      itemType: 'hn-story',
      threshold: 1,
      chain: [
        { provider: 'p1', config: {} },
        { provider: 'p2', config: {} },
      ],
    };
    const result = await runChain(source, { telemetry: { record: vi.fn() } });
    expect(result.ok).toBe(true);
    expect(result.tier_used).toBe(0);
    expect(result.items).toHaveLength(2);
  });

  it('falls through when tier returns below threshold', async () => {
    defineProvider('p1', async () => ({ ok: true, items: [makeHN(1)] }));
    defineProvider('p2', async () => ({ ok: true, items: [makeHN(1), makeHN(2), makeHN(3)] }));
    const source = {
      id: 's',
      itemType: 'hn-story',
      threshold: 3,
      chain: [
        { provider: 'p1', config: {} },
        { provider: 'p2', config: {} },
      ],
    };
    const result = await runChain(source, { telemetry: { record: vi.fn() } });
    expect(result.tier_used).toBe(1);
    expect(result.items).toHaveLength(3);
  });

  it('falls through on ok:false', async () => {
    defineProvider('p1', async () => ({ ok: false, items: [], error: 'boom' }));
    defineProvider('p2', async () => ({ ok: true, items: [makeHN(1)] }));
    const source = {
      id: 's',
      itemType: 'hn-story',
      threshold: 1,
      chain: [
        { provider: 'p1', config: {} },
        { provider: 'p2', config: {} },
      ],
    };
    const result = await runChain(source, { telemetry: { record: vi.fn() } });
    expect(result.tier_used).toBe(1);
  });

  it('returns ok:false when all tiers exhausted', async () => {
    defineProvider('p1', async () => ({ ok: false, items: [], error: 'a' }));
    defineProvider('p2', async () => ({ ok: false, items: [], error: 'b' }));
    const source = {
      id: 's',
      itemType: 'hn-story',
      threshold: 1,
      chain: [
        { provider: 'p1', config: {} },
        { provider: 'p2', config: {} },
      ],
    };
    const result = await runChain(source, { telemetry: { record: vi.fn() } });
    expect(result.ok).toBe(false);
    expect(result.tier_used).toBe(-1);
  });

  it('records telemetry for every tier attempt', async () => {
    defineProvider('p1', async () => ({ ok: false, items: [] }));
    defineProvider('p2', async () => ({ ok: true, items: [makeHN(1)] }));
    const record = vi.fn();
    const source = {
      id: 's',
      itemType: 'hn-story',
      threshold: 1,
      chain: [
        { provider: 'p1', config: {} },
        { provider: 'p2', config: {} },
      ],
    };
    await runChain(source, { telemetry: { record } });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0].tier_index).toBe(0);
    expect(record.mock.calls[1][0].tier_index).toBe(1);
  });
});
