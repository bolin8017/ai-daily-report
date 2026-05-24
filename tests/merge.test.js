// Unit tests for src/lib/merge.js — mechanical assembly of editorial +
// curated section JSON into the final v2.1 report.

import { describe, expect, it } from 'vitest';
import { composeReport, extractIdSpace, findDanglingSourceLinks } from '../src/lib/merge.js';

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
