// Unit tests for src/lib/faithfulness.js — the Stage 3.5 guard that detects +
// soft-repairs temporal fabrication ("同天" vs a differently-dated source) and
// named-author misattribution. Regression fixtures are the real 2026-05-29
// Raschka + Willison cases.

import { describe, expect, it } from 'vitest';
import {
  applyRepairs,
  buildCuratedIndex,
  buildJudgePrompt,
  collectProseFields,
  detectAttributionClaims,
  detectTemporalFlags,
  extractSourceDate,
  parseJudgeVerdicts,
  resolveFieldItems,
  resolveSourceDate,
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
        takeaway:
          'KV-cache variants (sharing, compression) emerge as core inference optimizations.',
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
    const flags = detectTemporalFlags(editorial, idx, {
      reportDate: '2026-05-29',
      toleranceDays: 1,
    });
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
    const flags = detectTemporalFlags(editorial, idx, {
      reportDate: '2026-05-27',
      toleranceDays: 1,
    });
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

describe('detectAttributionClaims', () => {
  const idx = buildCuratedIndex(CURATED);

  it('emits a claim for the real 5/29 Raschka span and attaches the cited takeaway', () => {
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [
          {
            body: 'Sebastian Raschka 本週確認 GQA 在 Gemma 4 和 DeepSeek V4 Pro 中已量產。',
            source_links: ['pulse.ai_bloggers.3:sebastianraschka-5a2d1f8c'],
          },
        ],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    };
    const claims = detectAttributionClaims(editorial, idx);
    expect(claims).toHaveLength(1);
    expect(claims[0].author).toBe('Sebastian Raschka');
    expect(claims[0].path).toBe('signals.focus[0].body');
    expect(claims[0].citedItems[0].takeaway).toMatch(/KV-cache variants/);
    expect(claims[0].span).toMatch(/本週確認/);
  });

  it('emits citedItems:[] when the named author is not in the cited sources', () => {
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [
          {
            body: 'Andrej Karpathy 表示新架構勝出。',
            source_links: ['pulse.ai_bloggers.0:simonwillison-3a9f2e1b'],
          },
        ],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    };
    const claims = detectAttributionClaims(editorial, idx);
    expect(claims).toHaveLength(1);
    expect(claims[0].citedItems).toEqual([]);
  });

  it('does not emit when an author name has no claim verb nearby', () => {
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [
          { body: 'Sebastian Raschka 的文章很值得一讀。', source_links: ['pulse.ai_bloggers.3:x'] },
        ],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    };
    expect(detectAttributionClaims(editorial, idx)).toHaveLength(0);
  });
});

describe('buildJudgePrompt / parseJudgeVerdicts', () => {
  const claims = [
    {
      path: 'signals.focus[0].body',
      author: 'Sebastian Raschka',
      span: 'Sebastian Raschka 本週確認 GQA 在 Gemma 4 和 DeepSeek V4 Pro 中已量產。',
      citedItems: [
        {
          id: 'pulse.ai_bloggers.3:x',
          title: 'Recent Developments',
          takeaway: 'KV-cache variants emerge as core inference optimizations.',
          source: 'Sebastian Raschka',
          date: '2026-05-16',
        },
      ],
    },
  ];

  it('prompt names quote-first ternary + includes the takeaway as grounding', () => {
    const p = buildJudgePrompt(claims, '2026-05-29');
    expect(p).toMatch(/NO_SUPPORTING_QUOTE/);
    expect(p).toMatch(/SUPPORTED|CONTRADICTED|NOT_ENOUGH_INFO/);
    expect(p).toMatch(/KV-cache variants/);
  });

  it('instructs the judge to treat author attribution strictly', () => {
    const p = buildJudgePrompt(claims, '2026-05-29');
    expect(p).toMatch(/attribut/i);
    expect(p).toMatch(/names that exact|exact (person|entity)/i);
  });

  it('parses the judge JSON back into verdicts joined to claims by index', () => {
    const raw =
      'noise before [{"index":0,"verdict":"CONTRADICTED","supporting_quote":"NO_SUPPORTING_QUOTE","grounded_rewrite":"Sebastian Raschka 整理了 KV-cache 變體作為推論最佳化方向。"}] noise after';
    const verdicts = parseJudgeVerdicts(raw, claims);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toBe('CONTRADICTED');
    expect(verdicts[0].path).toBe('signals.focus[0].body');
    expect(verdicts[0].span).toMatch(/本週確認/);
  });

  it('returns [] on unparseable judge output (never throws)', () => {
    expect(parseJudgeVerdicts('not json at all', claims)).toEqual([]);
  });
});

describe('applyRepairs', () => {
  it('softens a temporal marker in lead.html and records the audit', () => {
    const editorial = {
      lead: { html: '<p>X 是同天出現的訊號</p>' },
      signals: { predictions: [] },
      ideation: {},
    };
    const { audit } = applyRepairs(
      editorial,
      {
        temporalFlags: [
          {
            path: 'lead.html',
            type: 'temporal',
            marker: '同天',
            offDate: [{ id: 'a', date: '2026-05-27' }],
          },
        ],
      },
      { reportDate: '2026-05-29' },
    );
    expect(editorial.lead.html).toContain('近期');
    expect(editorial.lead.html).not.toContain('同天');
    expect(editorial.faithfulness.repaired).toBe(1);
    expect(audit.flagged[0].type).toBe('temporal');
  });

  it('replaces a CONTRADICTED span with the grounded rewrite', () => {
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [{ body: 'Sebastian Raschka 本週確認 GQA 在 Gemma 4 中已量產。' }],
        predictions: [],
      },
      ideation: {},
    };
    const verdicts = [
      {
        path: 'signals.focus[0].body',
        author: 'Sebastian Raschka',
        span: 'Sebastian Raschka 本週確認 GQA 在 Gemma 4 中已量產。',
        verdict: 'CONTRADICTED',
        supporting_quote: 'NO_SUPPORTING_QUOTE',
        grounded_rewrite: 'Sebastian Raschka 整理了 KV-cache 變體作為推論最佳化方向。',
      },
    ];
    applyRepairs(
      editorial,
      { attributionVerdicts: verdicts },
      { reportDate: '2026-05-29', model: 'claude-sonnet-4-6', ranJudge: true },
    );
    expect(editorial.signals.focus[0].body).toMatch(/整理了/);
    expect(editorial.signals.focus[0].body).not.toMatch(/本週確認/);
    expect(editorial.faithfulness.ran_judge).toBe(true);
  });

  it('leaves SUPPORTED spans untouched', () => {
    const editorial = {
      lead: { html: '' },
      signals: { focus: [{ body: 'keep me' }], predictions: [] },
      ideation: {},
    };
    applyRepairs(
      editorial,
      {
        attributionVerdicts: [
          { path: 'signals.focus[0].body', span: 'keep me', verdict: 'SUPPORTED' },
        ],
      },
      {},
    );
    expect(editorial.signals.focus[0].body).toBe('keep me');
    expect(editorial.faithfulness.repaired).toBe(0);
  });
});

describe('resolveSourceDate', () => {
  it('prefers the sidecar date for an URL the regex cannot date', () => {
    const sidecar = { 'https://magazine.sebastianraschka.com/p/x': '2026-05-16' };
    expect(resolveSourceDate('https://magazine.sebastianraschka.com/p/x', sidecar)).toBe(
      '2026-05-16',
    );
  });
  it('falls back to the URL-path regex when the url is not in the sidecar', () => {
    expect(resolveSourceDate('https://simonwillison.net/2026/May/27/x/', {})).toBe('2026-05-27');
  });
  it('returns null when neither sidecar nor regex can date it', () => {
    expect(resolveSourceDate('https://github.com/owner/repo', {})).toBe(null);
  });
});

describe('detectTemporalFlags with sidecar (undateable URLs)', () => {
  const curated = {
    pulse: {
      ai_bloggers: [
        {
          id: 'pulse.ai_bloggers.0:sebastianraschka-kv',
          source: 'Sebastian Raschka',
          title: 'Recent Developments',
          url: 'https://magazine.sebastianraschka.com/p/x',
        },
      ],
    },
  };
  const idx = buildCuratedIndex(curated);
  const editorial = {
    lead: { html: '' },
    signals: {
      focus: [
        {
          body: 'X 與 Raschka 的整理同天出現',
          source_links: ['pulse.ai_bloggers.0:sebastianraschka-kv'],
        },
      ],
      predictions: [],
    },
    ideation: { general: [], work: [] },
  };

  it('flags a substack source (no URL date) dated 15 days stale via the sidecar', () => {
    const sidecar = { 'https://magazine.sebastianraschka.com/p/x': '2026-05-16' };
    const flags = detectTemporalFlags(editorial, idx, {
      reportDate: '2026-05-31',
      toleranceDays: 1,
      sidecar,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].path).toBe('signals.focus[0].body');
  });

  it('is blind to the same source without the sidecar (proves the data gap it closes)', () => {
    const flags = detectTemporalFlags(editorial, idx, {
      reportDate: '2026-05-31',
      toleranceDays: 1,
    });
    expect(flags).toHaveLength(0);
  });
});

describe('week-scale temporal markers', () => {
  const curated = {
    pulse: {
      ai_bloggers: [
        {
          id: 'pulse.ai_bloggers.0:sebastianraschka-kv',
          source: 'Sebastian Raschka',
          title: 'Recent Developments',
          url: 'https://magazine.sebastianraschka.com/p/x',
        },
      ],
    },
  };
  const idx = buildCuratedIndex(curated);
  const sidecar = { 'https://magazine.sebastianraschka.com/p/x': '2026-05-16' };

  it('flags 同一週 when a cited source is >7 days stale', () => {
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [
          {
            body: '三個廠商同一週對 KV cache 給出解法',
            source_links: ['pulse.ai_bloggers.0:sebastianraschka-kv'],
          },
        ],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    };
    const flags = detectTemporalFlags(editorial, idx, {
      reportDate: '2026-05-31',
      toleranceDays: 1,
      sidecar,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].marker).toMatch(/同一?週/);
  });

  it('flags 同時 only before a publish verb (同時發布), not 同時支援', () => {
    const base = (body) => ({
      lead: { html: '' },
      signals: {
        focus: [{ body, source_links: ['pulse.ai_bloggers.0:sebastianraschka-kv'] }],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    });
    const opts = { reportDate: '2026-05-31', toleranceDays: 1, sidecar };
    expect(detectTemporalFlags(base('Raschka 同時發布架構綜述'), idx, opts)).toHaveLength(1);
    expect(detectTemporalFlags(base('一個 plugin 同時支援三個編輯器'), idx, opts)).toHaveLength(0);
  });
});

describe('attribution stop-list (non-person bigrams)', () => {
  it('does NOT flag "Claude Code" as a claim-maker despite a nearby 確認 (5/31 false positive)', () => {
    const curated = {
      shipped: {
        trending: [
          {
            id: 'shipped.trending.1:anthropics/claude-code',
            name: 'claude-code',
            url: 'https://github.com/anthropics/claude-code',
          },
        ],
      },
    };
    const idx = buildCuratedIndex(curated);
    const editorial = {
      lead: { html: '' },
      signals: { focus: [], predictions: [] },
      ideation: {
        general: [
          {
            description: '你在用 Claude Code 重構，每次跑到一半要手動確認「要改這個檔案嗎」。',
            source_links: ['shipped.trending.1:anthropics/claude-code'],
          },
        ],
        work: [],
      },
    };
    expect(detectAttributionClaims(editorial, idx)).toHaveLength(0);
  });

  it('still flags a real person (Sebastian Raschka) with a claim verb', () => {
    const idx = buildCuratedIndex(CURATED);
    const editorial = {
      lead: { html: '' },
      signals: {
        focus: [
          {
            body: 'Sebastian Raschka 本週確認 GQA 已量產。',
            source_links: ['pulse.ai_bloggers.3:sebastianraschka-5a2d1f8c'],
          },
        ],
        predictions: [],
      },
      ideation: { general: [], work: [] },
    };
    expect(detectAttributionClaims(editorial, idx)).toHaveLength(1);
  });
});
