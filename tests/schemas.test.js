// Smoke tests for Zod schemas — ensures real fixture data validates cleanly.
// Run with: npx vitest

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/schemas/config.js';
import { FeedItemSchema } from '../src/schemas/feed-item.js';
import { ReportSchema } from '../src/schemas/report.js';
import { StagingMetadataSchema } from '../src/schemas/staging.js';

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

function latestReport() {
  const dir = 'data/reports';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  return files.length > 0 ? `${dir}/${files[0]}` : null;
}

describe('schemas', () => {
  it('config.json passes ConfigSchema', () => {
    const result = ConfigSchema.safeParse(json('config.json'));
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it.skipIf(!latestReport())('latest report passes ReportSchema (v2 only)', () => {
    const r = json(latestReport());
    // v1.x reports (no schema_version) predate the v2 schema and use legacy templates;
    // they are not expected to validate against the strict v2 ReportSchema.
    if (r.schema_version !== 2) return;
    const result = ReportSchema.safeParse(r);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('ReportSchema v2 parses a minimal report', () => {
    const minimalV2 = {
      schema_version: 2,
      date: '2026-05-22',
      lead: { html: '<h3>Today</h3>' },
      signals: {
        focus: [{ id: 'signals.focus.0', title: 'X happened' }],
        predictions: [
          {
            id: 'p1',
            text: 'Y will happen',
            resolution_date: '2026-12-31',
          },
        ],
      },
      ideation: {
        general: [{ id: 'g1', audience: 'general', title: 'Idea G', description: 'd' }],
        work: [{ id: 'w1', audience: 'work', title: 'Idea W', description: 'd' }],
      },
      shipped: {},
      pulse: {},
      market: {},
      tech: {},
    };
    const result = ReportSchema.safeParse(minimalV2);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('ReportSchema v2 rejects missing schema_version', () => {
    const minimalV2 = {
      date: '2026-05-22',
      lead: { html: '<h3>X</h3>' },
      signals: { focus: [], predictions: [] },
      ideation: { general: [], work: [] },
      shipped: {},
      pulse: {},
      market: {},
      tech: {},
    };
    expect(ReportSchema.safeParse(minimalV2).success).toBe(false);
  });

  it.skipIf(!existsSync('data/staging/metadata.json'))(
    'data/staging/metadata.json passes StagingMetadataSchema',
    () => {
      const result = StagingMetadataSchema.safeParse(json('data/staging/metadata.json'));
      if (!result.success) console.error(result.error.issues);
      expect(result.success).toBe(true);
    },
  );

  it('StagingMetadataSchema accepts feeds_sections in sources', () => {
    const metadata = {
      date: '2026-06-05',
      run_id: '00000000-0000-4000-8000-000000000000',
      pipeline_version: 'abc1234',
      collected_at: '2026-06-05T00:00:00.000Z',
      timezone: 'Asia/Taipei',
      sources: {
        feeds: { ok: true, count: 120 },
        trending: { ok: true, count: 25 },
        search: { ok: true, count: 30 },
        developers: { ok: true, count: 10 },
        feeds_sections: { pulse: 12, market: 9, tech: 7 },
      },
      degraded: [],
    };
    const result = StagingMetadataSchema.safeParse(metadata);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('ConfigSchema accepts the minimal post-cutover shape (report + providers)', () => {
    const minimal = {
      report: { language: 'zh-TW', max_featured_items: 12, style: 'creative' },
    };
    const result = ConfigSchema.safeParse(minimal);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });
});

describe('feed item shape', () => {
  it('accepts a minimal HN item', () => {
    const result = FeedItemSchema.safeParse({
      source: 'hackernews',
      title: 'Test',
      url: 'https://example.com',
      hn_url: 'https://news.ycombinator.com/item?id=1',
      hn_id: '1',
      rank: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Lobsters item with score and num_comments', () => {
    const result = FeedItemSchema.safeParse({
      source: 'Lobsters',
      title: 'Test',
      url: 'https://example.com',
      score: 50,
      num_comments: 10,
      tags: ['programming'],
      rank: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects items missing url', () => {
    const result = FeedItemSchema.safeParse({
      source: 'hackernews',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('ReportMetaSchema (extended observability block)', () => {
  const baseReport = {
    schema_version: 2.1,
    date: '2026-06-02',
    lead: { html: '<p>x</p>' },
    signals: { focus: [], predictions: [] },
    ideation: { general: [], work: [] },
    shipped: {},
    pulse: {},
    market: {},
    tech: {},
  };

  it('accepts a meta block with per-stage usage + totals', () => {
    const r = ReportSchema.parse({
      ...baseReport,
      meta: {
        run_id: 'a1b2c3d4-0000-4000-8000-000000000000',
        pipeline_version: '0.1.0',
        model: 'claude-sonnet-4-6',
        generated_at: '2026-06-02T00:00:00.000Z',
        stages: {
          'curate.market': { cost_usd: 0.01, num_turns: 4, input_tokens: 1000, output_tokens: 50 },
          synthesize: { cost_usd: 0.3, num_turns: 12 },
        },
        total_cost_usd: 0.31,
        total_tokens: 1050,
      },
    });
    expect(r.meta.stages.synthesize.num_turns).toBe(12);
    expect(r.meta.total_cost_usd).toBeCloseTo(0.31);
  });

  it('accepts a partial meta block (all fields optional)', () => {
    expect(() => ReportSchema.parse({ ...baseReport, meta: { stages: {} } })).not.toThrow();
  });

  it('rejects a negative cost in a stage', () => {
    expect(() =>
      ReportSchema.parse({
        ...baseReport,
        meta: { stages: { synthesize: { cost_usd: -1 } } },
      }),
    ).toThrow();
  });
});
