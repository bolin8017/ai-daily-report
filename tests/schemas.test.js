// Smoke tests for Zod schemas — ensures real fixture data validates cleanly.
// Run with: npx vitest

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/schemas/config.js';
import { FeedItemSchema } from '../src/schemas/feed-item.js';
import { MemorySchema } from '../src/schemas/memory.js';
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

  it.skipIf(!existsSync('data/memory.json'))('data/memory.json passes MemorySchema', () => {
    const result = MemorySchema.safeParse(json('data/memory.json'));
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it.skipIf(!existsSync('data/staging/metadata.json'))(
    'data/staging/metadata.json passes StagingMetadataSchema',
    () => {
      const result = StagingMetadataSchema.safeParse(json('data/staging/metadata.json'));
      if (!result.success) console.error(result.error.issues);
      expect(result.success).toBe(true);
    },
  );

  it('ConfigSchema accepts lenses[] with ai-builder default', () => {
    const minimal = {
      sources: {
        rsshub_urls: ['https://rsshub.example.com'],
        feeds: [],
        github_topics: { enabled: true, topics: [], limit_per_topic: 10 },
        github_developers: {
          enabled: true,
          global_limit: 10,
          global_min_followers: 100,
          regions: [],
          new_repo_window_hours: 24,
        },
      },
      lenses: [
        {
          id: 'ai-builder',
          name: '今日 AI',
          prompt_file: '.claude/lenses/ai-builder.md',
          output_paths: {
            report: 'data/reports/{date}.json',
            memory: 'data/memory.json',
          },
        },
      ],
      report: { language: 'zh-TW', max_featured_items: 12, style: 'creative' },
    };
    const result = ConfigSchema.safeParse(minimal);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('ConfigSchema rejects empty lenses[] array', () => {
    const minimal = {
      sources: {
        rsshub_urls: ['https://rsshub.example.com'],
        feeds: [],
        github_topics: { enabled: true, topics: [], limit_per_topic: 10 },
        github_developers: {
          enabled: true,
          global_limit: 10,
          global_min_followers: 100,
          regions: [],
          new_repo_window_hours: 24,
        },
      },
      lenses: [],
      report: { language: 'zh-TW', max_featured_items: 12, style: 'creative' },
    };
    const result = ConfigSchema.safeParse(minimal);
    expect(result.success).toBe(false);
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
