import { describe, expect, it } from 'vitest';
import { lintReport } from '../src/lib/report-lint.js';

const checks = (r) => lintReport(r).findings.map((f) => f.check);

function base(overrides = {}) {
  return {
    date: '2026-06-18',
    lead: { html: '<p>clean lead</p>' },
    signals: { focus: [], predictions: [] },
    ...overrides,
  };
}

describe('lintReport — clean report', () => {
  it('returns no findings and zeroed counts for clean prose', () => {
    const r = base({
      signals: {
        focus: [{ id: 'f', title: '乾淨標題', body: 'Anthropic 跳過半年 catch-up' }],
        predictions: [],
      },
      market: { funding: [{ id: 'm', title: 't', takeaway: '本季營收 $2B，年增 40%' }] },
    });
    const out = lintReport(r);
    expect(out.findings).toEqual([]);
    expect(out.counts).toEqual({});
  });
});

describe('lintReport — slug_leak', () => {
  it('flags a leaked multi-segment id slug, not legit hyphenated words', () => {
    const r = base({
      signals: {
        focus: [{ id: 'f', title: 't', body: '見 arc-anthropic-vertical-integration 的脈絡' }],
        predictions: [],
      },
      tech: {
        models: [{ id: 't1', title: 't', takeaway: 'thread-safe 的設計，topic-based 路由' }],
      },
    });
    const f = lintReport(r).findings;
    expect(
      f.some((x) => x.check === 'slug_leak' && x.snippet === 'arc-anthropic-vertical-integration'),
    ).toBe(true);
    // "thread-safe" / "topic-based" are single-segment → NOT flagged
    expect(f.filter((x) => x.check === 'slug_leak')).toHaveLength(1);
  });
});

describe('lintReport — mojibake', () => {
  it('flags the replacement char and 3+ question-mark runs', () => {
    const r = base({ lead: { html: '壞掉的字� 還有 ???? 連續問號' } });
    expect(checks(r)).toContain('mojibake');
  });
});

describe('lintReport — slop_phrase', () => {
  it('flags a banned 套語 phrase from quality.md', () => {
    const r = base({
      signals: {
        focus: [{ id: 'f', title: 't', body: '這件事值得關注，且不容忽視' }],
        predictions: [],
      },
    });
    const f = lintReport(r).findings.filter((x) => x.check === 'slop_phrase');
    expect(f.map((x) => x.snippet).sort()).toEqual(['不容忽視', '值得關注']);
  });
});

describe('lintReport — unhedged_forward', () => {
  it('flags a future-year magnitude with no hedge in a market takeaway', () => {
    const r = base({
      market: { funding: [{ id: 'm', title: 't', takeaway: '2028 市場規模 $50B' }] },
    });
    expect(checks(r)).toContain('unhedged_forward');
  });
  it('does NOT flag when hedged', () => {
    const r = base({
      market: { funding: [{ id: 'm', title: 't', takeaway: '預計 2028 市場規模上看 $50B' }] },
    });
    expect(checks(r)).not.toContain('unhedged_forward');
  });
  it('does NOT flag a current/past-year magnitude', () => {
    const r = base({
      market: { funding: [{ id: 'm', title: 't', takeaway: '2025 市場規模 $50B' }] },
    });
    expect(checks(r)).not.toContain('unhedged_forward');
  });
  it('only scopes to market/tech takeaways, not pulse', () => {
    const r = base({
      pulse: { hn: [{ id: 'p', title: '2028 上看 $50B', takeaway: '2028 $50B' }] },
    });
    expect(checks(r)).not.toContain('unhedged_forward');
  });
});

describe('lintReport — counts + robustness', () => {
  it('tallies counts by check and tolerates missing/garbage sections', () => {
    const r = base({
      signals: { focus: [{ id: 'f', title: '值得關注', body: '不容忽視' }], predictions: [] },
      weird: [1, 2, 3],
      market: null,
    });
    const out = lintReport(r);
    expect(out.counts.slop_phrase).toBe(2);
    expect(() => lintReport(null)).not.toThrow();
  });
});
