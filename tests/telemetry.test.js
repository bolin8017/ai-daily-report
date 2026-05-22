import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelemetry } from '../src/lib/telemetry.js';

describe('telemetry', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tel-'));
  });

  it('records entries and writes summary JSON', async () => {
    const tel = createTelemetry({ outDir: dir, date: '2026-05-22' });
    tel.record({
      source_id: 'a',
      tier_index: 0,
      provider: 'p1',
      ok: true,
      items: 5,
      latency_ms: 10,
    });
    tel.record({
      source_id: 'b',
      tier_index: 0,
      provider: 'p1',
      ok: false,
      items: 0,
      latency_ms: 1,
      error: 'tier 0 failed',
    });
    tel.record({
      source_id: 'b',
      tier_index: 1,
      provider: 'p2',
      ok: true,
      items: 3,
      latency_ms: 20,
    });
    await tel.flush({ quota: { firecrawl: { before: 500, after: 498, used_today: 2 } } });

    const raw = await readFile(join(dir, '2026-05-22.json'), 'utf8');
    const parsed = JSON.parse(raw);

    expect(parsed.date).toBe('2026-05-22');
    expect(parsed.summary.sources_total).toBe(2);
    expect(parsed.sources).toHaveLength(2);
    const bSource = parsed.sources.find((s) => s.source_id === 'b');
    expect(bSource.tier_used).toBe(1);
    expect(bSource.fallback_reason).toContain('tier 0 failed');
    expect(parsed.quota.firecrawl.after).toBe(498);
  });

  it('counts degraded vs healthy correctly', async () => {
    const tel = createTelemetry({ outDir: dir, date: '2026-05-22' });
    tel.record({
      source_id: 'a',
      tier_index: 0,
      provider: 'p',
      ok: true,
      items: 5,
      latency_ms: 1,
    });
    tel.record({
      source_id: 'b',
      tier_index: 2,
      provider: 'p',
      ok: true,
      items: 5,
      latency_ms: 1,
    });
    tel.record({
      source_id: 'c',
      tier_index: 0,
      provider: 'p',
      ok: false,
      items: 0,
      latency_ms: 1,
    });
    await tel.flush({});

    const parsed = JSON.parse(await readFile(join(dir, '2026-05-22.json'), 'utf8'));
    expect(parsed.summary).toEqual({
      sources_total: 3,
      sources_healthy: 1,
      sources_degraded: 1,
      sources_failed: 1,
    });
  });
});
