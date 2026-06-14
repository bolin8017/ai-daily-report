// Schema coverage for the retired catalog ("精選") section. The section is no
// longer in the active theme (replaced by 新發現/discoveries on 2026-06-15), but
// CatalogCuratedSchema stays in the codebase so the 60-day legacy archive window
// of reports carrying a `catalog` block still validates + renders.

import { describe, expect, it } from 'vitest';
import { CatalogCuratedSchema } from '../src/schemas/curated.js';

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
