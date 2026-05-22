import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirecrawlQuota } from '../src/lib/quota.js';

describe('firecrawl quota', () => {
  let dir;
  let file;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q-'));
    file = join(dir, 'quota.json');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FIRECRAWL_DISABLED;
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('disabled flag short-circuits', async () => {
    process.env.FIRECRAWL_DISABLED = '1';
    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    const status = await q.canSpend();
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe('disabled');
  });

  it('uses API when FIRECRAWL_API_KEY set and endpoint reachable', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-xxx';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ remaining_credits: 100 }),
      }),
    );
    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    const status = await q.canSpend();
    expect(status.allowed).toBe(true);
    expect(status.source).toBe('api');
    expect(status.remaining).toBe(100);
  });

  it('falls back to local counter when API errors', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-xxx';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const month = new Date().toISOString().slice(0, 7);
    await writeFile(file, JSON.stringify({ firecrawl: { month, used: 480 } }));

    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    const status = await q.canSpend();
    expect(status.source).toBe('local');
    expect(status.remaining).toBe(20);
  });

  it('record() increments local counter', async () => {
    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    await q.record(3);
    const data = JSON.parse(await readFile(file, 'utf8'));
    const month = new Date().toISOString().slice(0, 7);
    expect(data.firecrawl.month).toBe(month);
    expect(data.firecrawl.used).toBe(3);
  });

  it('resets counter on month change', async () => {
    await writeFile(file, JSON.stringify({ firecrawl: { month: '1999-01', used: 999 } }));
    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    await q.record(1);
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(data.firecrawl.used).toBe(1);
  });

  it('returns 0 remaining when local counter exhausted', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const month = new Date().toISOString().slice(0, 7);
    await writeFile(file, JSON.stringify({ firecrawl: { month, used: 500 } }));
    const q = createFirecrawlQuota({ file, monthlyCap: 500 });
    const status = await q.canSpend();
    expect(status.allowed).toBe(false);
    expect(status.remaining).toBe(0);
  });
});
