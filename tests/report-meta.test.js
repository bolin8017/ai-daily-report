import { describe, expect, it } from 'vitest';
import { aggregateMeta, aggregateTotals } from '../src/lib/report-meta.js';
import { ReportSchema } from '../src/schemas/report.js';

describe('aggregateTotals', () => {
  it('sums cost and input+output tokens, ignoring cache tokens', () => {
    const totals = aggregateTotals({
      a: { cost_usd: 0.1, input_tokens: 100, output_tokens: 10, cache_read_tokens: 999 },
      b: { cost_usd: 0.2, input_tokens: 200, output_tokens: 20 },
    });
    expect(totals.total_cost_usd).toBeCloseTo(0.3);
    expect(totals.total_tokens).toBe(330);
  });

  it('returns undefined totals when no stage carries the data', () => {
    expect(aggregateTotals({ a: { num_turns: 3 } })).toEqual({
      total_cost_usd: undefined,
      total_tokens: undefined,
    });
  });
});

describe('aggregateMeta', () => {
  const stagingMeta = {
    run_id: 'a1b2c3d4-0000-4000-8000-000000000000',
    pipeline_version: '0.1.0',
    sources: { hn: { ok: true, count: 5 } },
    degraded: ['lobsters'],
  };

  it('combines staging identity/health, stages, and totals', () => {
    const meta = aggregateMeta({
      stagingMeta,
      stages: { synthesize: { cost_usd: 0.3, input_tokens: 100, output_tokens: 10 } },
      model: 'claude-sonnet-4-6',
      generatedAt: '2026-06-02T00:00:00.000Z',
      analyzeDurationMs: 1234,
    });
    expect(meta.run_id).toBe(stagingMeta.run_id);
    expect(meta.source_health.hn.count).toBe(5);
    expect(meta.degraded_sources).toEqual(['lobsters']);
    expect(meta.stages.synthesize.cost_usd).toBe(0.3);
    expect(meta.total_cost_usd).toBeCloseTo(0.3);
    expect(meta.total_tokens).toBe(110);
    expect(meta.analyze_duration_ms).toBe(1234);
  });

  it('keeps source_health uniform and surfaces feeds_sections separately', () => {
    // Regression for the 2026-06-06 Stage-4 abort: feeds_sections (a section→count
    // breakdown) used to ride inside `sources`, so aggregateMeta copied it
    // wholesale into source_health — which the report schema types as a uniform
    // {ok,count} map, making validation fail on the missing ok/count. The fix
    // moves feeds_sections to a top-level sibling; here we assert the composed
    // meta both keeps source_health clean AND validates against the report schema.
    const meta = aggregateMeta({
      stagingMeta: {
        run_id: 'a1b2c3d4-0000-4000-8000-000000000000',
        sources: {
          feeds: { ok: true, count: 658 },
          trending: { ok: true, count: 17 },
          arxiv: { ok: true, count: 30 },
        },
        feeds_sections: { pulse: 245, market: 193, tech: 54, shipped: 53 },
        degraded: [],
      },
      stages: {},
    });
    expect(meta.source_health.feeds_sections).toBeUndefined();
    expect(meta.source_health.feeds.count).toBe(658);
    expect(meta.feeds_sections).toEqual({ pulse: 245, market: 193, tech: 54, shipped: 53 });

    // ReportSchema.shape.meta is ReportMetaSchema wrapped in .optional() — this is
    // the exact gate Stage 4 (composeReport) runs, and what failed in production.
    const result = ReportSchema.shape.meta.safeParse(meta);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('returns null when there is nothing to record', () => {
    expect(aggregateMeta({ stagingMeta: {}, stages: {} })).toBeNull();
  });

  it('omits stages/totals when no sidecars were collected', () => {
    const meta = aggregateMeta({ stagingMeta, stages: {}, model: 'm' });
    expect(meta.stages).toBeUndefined();
    expect(meta.total_cost_usd).toBeUndefined();
    expect(meta.run_id).toBe(stagingMeta.run_id);
  });
});
