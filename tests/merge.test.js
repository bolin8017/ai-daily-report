// Unit tests for src/lib/merge.js — mechanical assembly of editorial +
// curated section JSON into the final v2.1 report.

import { describe, expect, it } from 'vitest';
import { BENCH_LEADERBOARD_URL } from '../src/lib/leaderboard-urls.js';
import {
  composeReport,
  extractIdSpace,
  findDanglingSourceLinks,
  idPrefix,
  stripDanglingSourceLinks,
} from '../src/lib/merge.js';

// Minimal valid fixtures matching the live shape (just enough fields to pass
// section schemas).
function fixtureEditorial(overrides = {}) {
  return {
    schema_version: '2.1-editorial',
    date: '2026-05-24',
    theme: 'ai-builder',
    lead: { html: '<p>lead</p>' },
    signals: {
      focus: [
        {
          id: 'sig.focus.0',
          title: 's',
          body: 'b',
          audience: 'general',
          source_links: ['shipped.trending.0:foo/bar'],
        },
      ],
      predictions: [],
    },
    ...overrides,
  };
}

function fixtureCurated() {
  return {
    shipped: {
      trending: [
        {
          id: 'shipped.trending.0:foo/bar',
          name: 'foo/bar',
          desc: 'd',
          audience: 'general',
        },
      ],
    },
    pulse: {
      hn: [
        {
          id: 'pulse.hn.0:hn-1',
          title: 't',
          audience: 'general',
        },
      ],
    },
    market: { ma: [] },
    tech: { vendor: [] },
  };
}

describe('extractIdSpace', () => {
  it('collects ids across all curated sections + sub-groups', () => {
    const curated = fixtureCurated();
    const ids = extractIdSpace(curated);
    expect(ids.has('shipped.trending.0:foo/bar')).toBe(true);
    expect(ids.has('pulse.hn.0:hn-1')).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe('findDanglingSourceLinks', () => {
  it('returns empty when all source_links resolve', () => {
    const editorial = fixtureEditorial();
    const idSpace = extractIdSpace(fixtureCurated());
    expect(findDanglingSourceLinks(editorial, idSpace)).toEqual([]);
  });

  it('lists each dangling link with the editorial field path', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [
          {
            id: 'sig.focus.0',
            title: 's',
            body: 'b',
            audience: 'general',
            source_links: ['nonexistent.id'],
          },
        ],
        predictions: [],
      },
    });
    const idSpace = extractIdSpace(fixtureCurated());
    const dangling = findDanglingSourceLinks(editorial, idSpace);
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatch(/nonexistent\.id/);
  });

  // Regression: the 2026-05-28 run aborted because the synthesizer wrote
  // source_links as the bare "group.subgroup.index" prefix, dropping the
  // ":slug" suffix curators append to each item id. The prefix is already
  // unique, so a prefix-only reference must still resolve to its item.
  it('resolves a source_link that omits the curated id :slug suffix', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [
          {
            id: 'sig.focus.0',
            title: 's',
            body: 'b',
            audience: 'general',
            source_links: ['shipped.trending.0'],
          },
        ],
        predictions: [],
      },
    });
    const idSpace = extractIdSpace(fixtureCurated());
    expect(findDanglingSourceLinks(editorial, idSpace)).toEqual([]);
  });

  // Prefix tolerance must not resolve references to indices that do not
  // exist — a wrong index is still a genuine dangling link.
  it('still flags a prefix that points to no curated item', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [
          {
            id: 'sig.focus.0',
            title: 's',
            body: 'b',
            audience: 'general',
            source_links: ['shipped.trending.9'],
          },
        ],
        predictions: [],
      },
    });
    const idSpace = extractIdSpace(fixtureCurated());
    const dangling = findDanglingSourceLinks(editorial, idSpace);
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatch(/shipped\.trending\.9/);
  });
});

describe('stripDanglingSourceLinks', () => {
  it('returns the editorial unchanged with no drops when all links resolve', () => {
    const editorial = fixtureEditorial();
    const idSpace = extractIdSpace(fixtureCurated());
    const { editorial: out, dropped } = stripDanglingSourceLinks(editorial, idSpace);
    expect(dropped).toEqual([]);
    expect(out.signals.focus[0].source_links).toEqual(['shipped.trending.0:foo/bar']);
  });

  it('removes only the unresolvable ids and reports their paths, keeping resolvable ones', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [
          {
            id: 'sig.focus.0',
            title: 's',
            body: 'b',
            audience: 'general',
            source_links: ['shipped.trending.0', 'shipped.trending.9', 'ghost.id'],
          },
        ],
        predictions: [],
      },
    });
    const idSpace = extractIdSpace(fixtureCurated());
    const { editorial: out, dropped } = stripDanglingSourceLinks(editorial, idSpace);
    expect(out.signals.focus[0].source_links).toEqual(['shipped.trending.0']);
    expect(dropped).toHaveLength(2);
    expect(dropped.join('\n')).toMatch(/shipped\.trending\.9/);
    expect(dropped.join('\n')).toMatch(/ghost\.id/);
  });

  it('does not mutate the input editorial', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [{ id: 'sig.focus.0', title: 's', audience: 'general', source_links: ['ghost.id'] }],
        predictions: [],
      },
    });
    const snapshot = JSON.stringify(editorial);
    stripDanglingSourceLinks(editorial, extractIdSpace(fixtureCurated()));
    expect(JSON.stringify(editorial)).toBe(snapshot);
  });

  it('strips dangling links inside an optional sleeper signal', () => {
    const editorial = fixtureEditorial({
      signals: {
        focus: [],
        predictions: [],
        sleeper: {
          id: 'sig.sleeper',
          title: 's',
          audience: 'general',
          source_links: ['ghost.id', 'pulse.hn.0:hn-1'],
        },
      },
    });
    const { editorial: out, dropped } = stripDanglingSourceLinks(
      editorial,
      extractIdSpace(fixtureCurated()),
    );
    expect(out.signals.sleeper.source_links).toEqual(['pulse.hn.0:hn-1']);
    expect(dropped).toHaveLength(1);
  });
});

describe('composeReport', () => {
  it('merges editorial + curated into a valid 2.1 report', async () => {
    const report = await composeReport({
      editorial: fixtureEditorial(),
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.schema_version).toBe(2.1);
    expect(report.date).toBe('2026-05-24');
    expect(report.lead.html).toBe('<p>lead</p>');
    expect(report.signals.focus).toHaveLength(1);
    expect(report.shipped.trending[0].id).toBe('shipped.trending.0:foo/bar');
    expect(report.pulse.hn[0].id).toBe('pulse.hn.0:hn-1');
  });

  // Path Y: a dangling source_link no longer aborts the report. The dead
  // reference is dropped, the citing item still renders, and the run continues.
  it('drops a dangling source_link and still composes the report', async () => {
    const report = await composeReport({
      editorial: fixtureEditorial({
        signals: {
          focus: [
            {
              id: 'sig.focus.0',
              title: 's',
              body: 'b',
              audience: 'general',
              // one real id + one ghost — the ghost is dropped, the real one kept
              source_links: ['shipped.trending.0:foo/bar', 'ghost.id'],
            },
          ],
          predictions: [],
        },
      }),
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.schema_version).toBe(2.1);
    expect(report.signals.focus[0].source_links).toEqual(['shipped.trending.0:foo/bar']);
  });

  // The 2026-05-28 run aborted here: every source_link was a bare prefix
  // missing its :slug, so the merge reported 44 dangling references and the
  // pipeline produced no report. Composing must now succeed.
  it('composes when source_links use the bare prefix (no :slug)', async () => {
    const report = await composeReport({
      editorial: fixtureEditorial({
        signals: {
          focus: [
            {
              id: 'sig.focus.0',
              title: 's',
              body: 'b',
              audience: 'general',
              source_links: ['shipped.trending.0', 'pulse.hn.0'],
            },
          ],
          predictions: [],
        },
      }),
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.schema_version).toBe(2.1);
    expect(report.signals.focus[0].source_links).toEqual(['shipped.trending.0', 'pulse.hn.0']);
  });

  it('preserves editorial signals under the same name in the merged report', async () => {
    const editorial = fixtureEditorial();
    const report = await composeReport({
      editorial,
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.signals).toEqual(editorial.signals);
    // Soft guarantee: composeReport has no hard block on ideation — it relies on
    // the synthesizer no longer emitting it (Task 8). A stray ideation key in
    // editorial.json would still pass through. The fixture omits it, so it's undefined here.
    expect(report.ideation).toBeUndefined();
  });

  it('attaches a provided meta block to the composed report', async () => {
    const report = await composeReport({
      editorial: fixtureEditorial(),
      curated: fixtureCurated(),
      themeName: 'ai-builder',
      meta: {
        model: 'claude-sonnet-4-6',
        total_cost_usd: 0.42,
        stages: { synthesize: { num_turns: 9 } },
      },
    });
    expect(report.meta.total_cost_usd).toBeCloseTo(0.42);
    expect(report.meta.stages.synthesize.num_turns).toBe(9);
  });

  it('omits meta entirely when none is provided', async () => {
    const report = await composeReport({
      editorial: fixtureEditorial(),
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.meta).toBeUndefined();
  });

  it('composes a catalog section from curated picks', async () => {
    const curated = fixtureCurated();
    curated.catalog = {
      picks: [
        {
          id: 'catalog.picks.0:vllm-project/vllm',
          name: 'vllm-project/vllm',
          url: 'https://github.com/vllm-project/vllm',
          stars: 40000,
          category: 'ai',
          audience: 'both',
          takeaway: '高吞吐 LLM 推論引擎。',
        },
      ],
    };
    const report = await composeReport({
      editorial: fixtureEditorial(),
      curated,
      themeName: 'ai-builder',
    });
    expect(report.catalog.picks[0].id).toBe('catalog.picks.0:vllm-project/vllm');
  });
});

// Benchmark leaderboard items carry only rankings; the curator was asked to
// supply a "link to leaderboard" with no source and hallucinated a fabricated
// (often 404) url every day. merge deterministically replaces it with the
// canonical leaderboard url, and strips the url from a ghost benchmark that has
// no backing leaderboard (e.g. an MTEB item invented from a stale prompt).
describe('composeReport benchmark URL cure', () => {
  function curatedWithBenchmarks(benchmarks) {
    return {
      shipped: { trending: [] },
      pulse: { hn: [] },
      market: { ma: [] },
      tech: { vendor: [], benchmarks },
    };
  }
  const emptyEditorial = fixtureEditorial({ signals: { focus: [], predictions: [] } });

  it('replaces fabricated benchmark urls with the canonical leaderboard url', async () => {
    const report = await composeReport({
      editorial: emptyEditorial,
      curated: curatedWithBenchmarks([
        {
          id: 'tech.benchmarks.0:ocrbench',
          title: 'OCRBench: Nemotron Nano VL 8B leads object-text understanding',
          url: 'https://github.com/Yuliang-Liu/Multimodal-OCR', // 404 the user hit
          audience: 'work',
        },
        {
          id: 'tech.benchmarks.1:bfcl',
          title: 'BFCL: function-calling parity across vendors',
          url: 'https://huggingface.co/spaces/anybodys/BFCL', // fabricated
          audience: 'work',
        },
        {
          id: 'tech.benchmarks.2:swebench',
          title: 'SWE-Bench Verified: Live-SWE-agent + Opus 4.5 #1',
          url: 'https://www.swebench.com/', // happened to be correct
          audience: 'work',
        },
      ]),
      themeName: 'ai-builder',
    });
    expect(report.tech.benchmarks[0].url).toBe(BENCH_LEADERBOARD_URL.ocrbench);
    expect(report.tech.benchmarks[1].url).toBe(BENCH_LEADERBOARD_URL.bfcl);
    expect(report.tech.benchmarks[2].url).toBe(BENCH_LEADERBOARD_URL.swebench);
  });

  it('strips the url from a ghost benchmark with no backing leaderboard', async () => {
    const report = await composeReport({
      editorial: emptyEditorial,
      curated: curatedWithBenchmarks([
        {
          id: 'tech.benchmarks.0:mteb',
          title: 'MTEB Leaderboard: Claude models dominate embedding tasks',
          url: 'https://huggingface.co/spaces/mteb/leaderboard',
          audience: 'work',
        },
      ]),
      themeName: 'ai-builder',
    });
    expect(report.tech.benchmarks[0].url).toBeUndefined();
  });

  it('does not mutate the caller-supplied curated benchmarks', async () => {
    const curated = curatedWithBenchmarks([
      {
        id: 'tech.benchmarks.0:ocrbench',
        title: 'OCRBench: leader',
        url: 'https://github.com/fake/ocrbench',
        audience: 'work',
      },
    ]);
    await composeReport({ editorial: emptyEditorial, curated, themeName: 'ai-builder' });
    expect(curated.tech.benchmarks[0].url).toBe('https://github.com/fake/ocrbench');
  });
});

describe('idPrefix', () => {
  it('drops the :slug suffix, leaving the unique group.subgroup.index prefix', () => {
    expect(idPrefix('shipped.trending.0:vllm-project/vllm')).toBe('shipped.trending.0');
    expect(idPrefix('signals.focus.1')).toBe('signals.focus.1'); // no colon → unchanged
  });
});
