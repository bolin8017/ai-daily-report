// Unit tests for src/lib/faithfulness.js — the Stage 3.5 guard that detects +
// soft-repairs temporal fabrication ("同天" vs a differently-dated source) and
// named-author misattribution. Regression fixtures are the real 2026-05-29
// Raschka + Willison cases.

import { describe, expect, it } from 'vitest';
import { buildCuratedIndex, extractSourceDate } from '../src/lib/faithfulness.js';

describe('extractSourceDate', () => {
  it('parses ISO and path date shapes from real curated URLs', () => {
    expect(extractSourceDate('https://simonwillison.net/2026/May/27/sqlite-agents/')).toBe(
      '2026-05-27',
    );
    expect(extractSourceDate('https://technews.tw/2026/05/22/foo/')).toBe('2026-05-22');
    expect(extractSourceDate('https://lilianweng.github.io/posts/2025-05-01-thinking/')).toBe(
      '2025-05-01',
    );
  });
  it('returns null for dateless URLs (github repos, missing/garbage)', () => {
    expect(extractSourceDate('https://github.com/youssofal/MTPLX')).toBe(null);
    expect(extractSourceDate(undefined)).toBe(null);
    expect(extractSourceDate('https://example.com/2026/13/40/')).toBe(null); // month 13 invalid
  });
});

describe('buildCuratedIndex', () => {
  it('indexes every curated item by its id-prefix and keeps a flat item list', () => {
    const curated = {
      pulse: {
        ai_bloggers: [
          {
            id: 'pulse.ai_bloggers.0:simonwillison-3a9f2e1b',
            title: 'sqlite AGENTS.md',
            source: 'Simon Willison',
            url: 'https://simonwillison.net/2026/May/27/sqlite-agents/',
          },
        ],
      },
      shipped: {
        trending: [
          {
            id: 'shipped.trending.0:vllm-project/vllm',
            name: 'vllm',
            url: 'https://github.com/vllm-project/vllm',
          },
        ],
      },
    };
    const { byPrefix, items } = buildCuratedIndex(curated);
    expect(byPrefix.get('pulse.ai_bloggers.0').title).toBe('sqlite AGENTS.md');
    expect(byPrefix.get('shipped.trending.0').name).toBe('vllm');
    expect(items).toHaveLength(2);
  });
});
