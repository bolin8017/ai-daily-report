// Unit tests for src/lib/faithfulness.js — the Stage 3.5 guard that detects +
// soft-repairs temporal fabrication ("同天" vs a differently-dated source) and
// named-author misattribution. Regression fixtures are the real 2026-05-29
// Raschka + Willison cases.

import { describe, expect, it } from 'vitest';
import {
  buildCuratedIndex,
  collectProseFields,
  detectTemporalFlags,
  extractSourceDate,
  resolveFieldItems,
} from '../src/lib/faithfulness.js';

// Shared fixture: the two real 2026-05-29 curated items at the centre of the
// recurring hallucinations (Willison's date + Raschka's actual takeaway).
const CURATED = {
  pulse: {
    ai_bloggers: [
      {
        id: 'pulse.ai_bloggers.0:simonwillison-3a9f2e1b',
        title: 'sqlite AGENTS.md',
        source: 'Simon Willison',
        url: 'https://simonwillison.net/2026/May/27/sqlite-agents/',
      },
      {
        id: 'pulse.ai_bloggers.3:sebastianraschka-5a2d1f8c',
        title: 'Recent Developments in LLM Architectures',
        source: 'Sebastian Raschka',
        takeaway: 'KV-cache variants (sharing, compression) emerge as core inference optimizations.',
        url: 'https://magazine.sebastianraschka.com/p/recent-developments',
      },
    ],
  },
};

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

describe('collectProseFields', () => {
  it('yields lead.html (no source_links) + signal body/mechanism + ideation descriptions', () => {
    const editorial = {
      lead: { html: '<p>Simon Willison 同天出現</p>' },
      signals: {
        focus: [{ body: 'b', mechanism: 'm', source_links: ['pulse.ai_bloggers.3:x'] }],
        predictions: [],
      },
      ideation: {
        general: [{ description: 'd', source_links: ['shipped.trending.0:y'] }],
        work: [],
      },
    };
    const fields = collectProseFields(editorial);
    expect(fields.find((f) => f.path === 'lead.html').sourceLinks).toBe(null);
    expect(fields.find((f) => f.path === 'signals.focus[0].body').sourceLinks).toEqual([
      'pulse.ai_bloggers.3:x',
    ]);
    expect(fields.find((f) => f.path === 'ideation.general[0].description').sourceLinks).toEqual([
      'shipped.trending.0:y',
    ]);
  });
});

describe('resolveFieldItems', () => {
  it('resolves signal fields by source_link prefix', () => {
    const idx = buildCuratedIndex(CURATED);
    const items = resolveFieldItems({ sourceLinks: ['pulse.ai_bloggers.3'], text: '' }, idx);
    expect(items.map((i) => i.source)).toEqual(['Sebastian Raschka']);
  });
  it('resolves lead (sourceLinks=null) by entity match on source name and title', () => {
    const idx = buildCuratedIndex(CURATED);
    const items = resolveFieldItems(
      { sourceLinks: null, text: 'simon willison 的 sqlite agents.md 是同天出現' },
      idx,
    );
    expect(items.map((i) => i.id)).toContain('pulse.ai_bloggers.0:simonwillison-3a9f2e1b');
  });
});

describe('detectTemporalFlags', () => {
  const idx = buildCuratedIndex(CURATED);

  it('flags the real 5/29 lead: "同天" + a source dated 2026-05-27 on a 2026-05-29 report', () => {
    const editorial = {
      lead: { html: '<p>Simon Willison 的 SQLite AGENTS.md 是同天出現的第三個訊號</p>' },
      signals: { predictions: [] },
      ideation: { general: [], work: [] },
    };
    const flags = detectTemporalFlags(editorial, idx, { reportDate: '2026-05-29', toleranceDays: 1 });
    expect(flags).toHaveLength(1);
    expect(flags[0].path).toBe('lead.html');
    expect(flags[0].marker).toBe('同天');
  });

  it('does not flag when cited sources are within tolerance of the report date', () => {
    const editorial = {
      lead: { html: '<p>Simon Willison 同天</p>' },
      signals: { predictions: [] },
      ideation: { general: [], work: [] },
    };
    const flags = detectTemporalFlags(editorial, idx, { reportDate: '2026-05-27', toleranceDays: 1 });
    expect(flags).toHaveLength(0);
  });

  it('does not flag prose with no same-day marker', () => {
    const editorial = {
      lead: { html: '<p>Simon Willison 近期發表</p>' },
      signals: { predictions: [] },
      ideation: { general: [], work: [] },
    };
    expect(detectTemporalFlags(editorial, idx, { reportDate: '2026-05-29' })).toHaveLength(0);
  });
});
