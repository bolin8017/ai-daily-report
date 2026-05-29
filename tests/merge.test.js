// Unit tests for src/lib/merge.js — mechanical assembly of editorial +
// curated section JSON into the final v2.1 report.

import { describe, expect, it } from 'vitest';
import {
  composeReport,
  extractIdSpace,
  findDanglingSourceLinks,
  idPrefix,
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
    ideation: { general: [], work: [] },
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

  it('throws on dangling source_link with explicit id list', async () => {
    await expect(
      composeReport({
        editorial: fixtureEditorial({
          signals: {
            focus: [
              {
                id: 'sig.focus.0',
                title: 's',
                body: 'b',
                audience: 'general',
                source_links: ['ghost.id'],
              },
            ],
            predictions: [],
          },
        }),
        curated: fixtureCurated(),
        themeName: 'ai-builder',
      }),
    ).rejects.toThrow(/dangling source_link/);
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

  it('preserves editorial fields under the same names in the merged report', async () => {
    const editorial = fixtureEditorial();
    const report = await composeReport({
      editorial,
      curated: fixtureCurated(),
      themeName: 'ai-builder',
    });
    expect(report.ideation).toEqual(editorial.ideation);
    expect(report.signals).toEqual(editorial.signals);
  });
});

describe('idPrefix', () => {
  it('drops the :slug suffix, leaving the unique group.subgroup.index prefix', () => {
    expect(idPrefix('shipped.trending.0:vllm-project/vllm')).toBe('shipped.trending.0');
    expect(idPrefix('signals.focus.1')).toBe('signals.focus.1'); // no colon → unchanged
  });
});
