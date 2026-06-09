// Schema + composer coverage for the catalog ("精選") section.

import { describe, expect, it } from 'vitest';
import { CatalogCuratedSchema } from '../src/schemas/curated.js';
import { buildReportSchema } from '../src/schemas/report.js';

const validCurated = {
  picks: [
    {
      id: 'catalog.picks.0:vllm-project/vllm',
      name: 'vllm-project/vllm',
      url: 'https://github.com/vllm-project/vllm',
      stars: 40000,
      language: 'Python',
      category: 'ai',
      audience: 'both',
      takeaway: '高吞吐 LLM 推論引擎，PagedAttention 已是 serving 事實標準。',
    },
  ],
};

describe('CatalogCuratedSchema', () => {
  it('validates a well-formed catalog curator output', () => {
    expect(() => CatalogCuratedSchema.parse(validCurated)).not.toThrow();
  });
  it('rejects output missing the picks array', () => {
    expect(() => CatalogCuratedSchema.parse({})).toThrow();
  });
  it('accepts an empty picks array (catalog exhausted / thin day)', () => {
    expect(() => CatalogCuratedSchema.parse({ picks: [] })).not.toThrow();
  });
});

describe('buildReportSchema includes catalog', () => {
  it('accepts a report carrying a catalog section', async () => {
    const schema = await buildReportSchema('ai-builder');
    const report = {
      schema_version: 2.1,
      date: '2026-06-08',
      lead: { html: '<p>x</p>' },
      signals: { focus: [], predictions: [] },
      shipped: {},
      pulse: {},
      market: {},
      tech: {},
      catalog: validCurated,
    };
    expect(() => schema.parse(report)).not.toThrow();
  });
});
