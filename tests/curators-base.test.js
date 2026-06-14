import { describe, expect, it } from 'vitest';
import { mergePrompts, stableId, validateCuratedOutput } from '../src/curators/_base.js';
import { ShippedCuratedSchema } from '../src/schemas/curated.js';

describe('stableId', () => {
  it('builds GitHub repo id', () => {
    expect(
      stableId({
        section: 'shipped',
        sub: 'trending',
        index: 0,
        type: 'github',
        owner: 'vllm-project',
        repo: 'vllm',
      }),
    ).toBe('shipped.trending.0:vllm-project/vllm');
  });

  it('builds HN id', () => {
    expect(
      stableId({
        section: 'pulse',
        sub: 'hn',
        index: 3,
        type: 'hn',
        hn_id: '39827361',
      }),
    ).toBe('pulse.hn.3:hn-39827361');
  });

  it('builds MOPS id', () => {
    expect(
      stableId({
        section: 'market',
        sub: 'taiwan',
        index: 1,
        type: 'mops',
        ticker: '8299',
        date: '20260522',
      }),
    ).toBe('market.taiwan.1:mops-8299-20260522');
  });

  it('builds RSS hash id deterministically', () => {
    const make = () =>
      stableId({
        section: 'pulse',
        sub: 'ai_bloggers',
        index: 0,
        type: 'rss',
        source: 'simonwillison',
        url: 'https://example.com/post',
      });
    const a = make();
    const b = make();
    expect(a).toBe(b);
    expect(a).toMatch(/^pulse\.ai_bloggers\.0:simonwillison-[0-9a-f]{8}$/);
  });

  it('builds leaderboard id', () => {
    expect(
      stableId({
        section: 'tech',
        sub: 'benchmarks',
        index: 0,
        type: 'leaderboard',
        bench: 'mteb',
        model_id: 'bge-large-en-v1.5',
      }),
    ).toBe('tech.benchmarks.0:mteb-bge-large-en-v1.5');
  });

  it('throws on unknown type', () => {
    expect(() => stableId({ section: 'x', sub: 'y', index: 0, type: 'mystery' })).toThrow();
  });
});

describe('validateCuratedOutput', () => {
  it('returns parsed object for valid input', () => {
    const valid = {
      trending: [{ id: 'shipped.trending.0:foo/bar', name: 'bar' }],
      topic_discovery: [],
      dev_watch_taiwan: [],
      dev_watch_global: [],
    };
    const parsed = validateCuratedOutput(ShippedCuratedSchema, valid);
    expect(parsed.trending).toHaveLength(1);
  });

  it('throws with descriptive message on invalid input', () => {
    expect(() => validateCuratedOutput(ShippedCuratedSchema, { trending: 'not-an-array' })).toThrow(
      /trending/,
    );
  });
});

describe('mergePrompts', () => {
  it('concatenates shared + section prompt', async () => {
    const merged = await mergePrompts('discoveries');
    expect(merged).toContain('Curator shared voice');
    expect(merged).toContain('Curator: Discoveries');
    expect(merged.length).toBeGreaterThan(1000);
  });
});
