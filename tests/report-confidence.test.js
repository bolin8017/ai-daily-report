import { describe, expect, it } from 'vitest';
import { computeConfidence, hostnameOf } from '../src/lib/report-confidence.js';

// idSpace prefixes available for citation resolution.
const idSpace = new Set(['discoveries.rising.0:foo/bar', 'pulse.hn.0:hn-1']);

const sig = (id, links) => ({ id, title: 't', source_links: links });
const item = (id, url, source) => ({ id, url, source });

function report({
  focus = [],
  sleeper,
  contrarian,
  predictions = [],
  pulse = [],
  market = [],
} = {}) {
  const signals = { focus, predictions };
  if (sleeper) signals.sleeper = sleeper;
  if (contrarian) signals.contrarian = contrarian;
  return { signals, pulse: { hn: pulse }, market: { funding: market } };
}

// n pulse items, each with a distinct hostname.
const domainsN = (n) =>
  Array.from({ length: n }, (_, i) =>
    item(`pulse.hn.${i}`, `https://d${i}.example${i}.com/x`, 'hackernews'),
  );

describe('hostnameOf', () => {
  it('lowercases and strips leading www.', () => {
    expect(hostnameOf('https://www.Foo.com/x')).toBe('foo.com');
    expect(hostnameOf('https://bar.org')).toBe('bar.org');
  });
  it('returns null for an unparseable url', () => {
    expect(hostnameOf('garbage')).toBeNull();
    expect(hostnameOf(undefined)).toBeNull();
  });
});

describe('computeConfidence — citation coverage', () => {
  it('counts claim-bearing signals (focus+sleeper+contrarian), excludes predictions', () => {
    const r = report({
      focus: [sig('f', ['discoveries.rising.0:foo/bar'])], // cited
      sleeper: sig('sl', []), // not cited
      contrarian: sig('co', ['pulse.hn.0:hn-1']), // cited
      predictions: [{ id: 'p', text: 't', resolution_date: '2026-12-31' }], // excluded
    });
    const c = computeConfidence(r, idSpace);
    expect(c.cited_signals).toBe('2/3');
    expect(c.citation_coverage).toBeCloseTo(2 / 3);
  });

  it('treats a dangling/empty source_link as uncited', () => {
    const r = report({
      focus: [sig('a', ['discoveries.rising.0:foo/bar']), sig('b', ['bogus.9:z']), sig('c', [])],
    });
    expect(computeConfidence(r, idSpace).cited_signals).toBe('1/3');
  });

  it('returns null coverage and null band when there are no claim-bearing signals', () => {
    const r = report({
      focus: [],
      predictions: [{ id: 'p', text: 't', resolution_date: '2026-12-31' }],
    });
    const c = computeConfidence(r, idSpace);
    expect(c.citation_coverage).toBeNull();
    expect(c.band).toBeNull();
    expect(c.cited_signals).toBeUndefined();
  });
});

describe('computeConfidence — unique_domains', () => {
  it('counts distinct hostnames, strips www., skips bad urls', () => {
    const r = report({
      focus: [sig('f', ['discoveries.rising.0:foo/bar'])],
      pulse: [
        item('pulse.hn.0', 'https://www.example.com/a', 'hackernews'),
        item('pulse.hn.1', 'https://example.com/b', 'hackernews'), // same host after www strip
        item('pulse.hn.2', 'not-a-url', 'hackernews'), // skipped
        item('pulse.hn.3', 'https://other.org/c', 'hackernews'),
      ],
    });
    expect(computeConfidence(r, idSpace).unique_domains).toBe(2);
  });
});

describe('computeConfidence — source_tier', () => {
  it('counts structured sources and authoritative domains as trusted', () => {
    const r = report({
      focus: [sig('f', ['discoveries.rising.0:foo/bar'])],
      pulse: [
        item('a', 'https://blog.io/x', 'hackernews'), // neither
        item('b', 'https://foo.gov/y', 'mops'), // authoritative (.gov) AND structured
        item('c', 'https://random.com/z', 'leaderboards'), // structured
      ],
    });
    expect(computeConfidence(r, idSpace).source_tier).toBeCloseTo(2 / 3);
  });
});

describe('computeConfidence — null/garbage input guard', () => {
  it('returns a null band and does not throw on a null/garbage report', () => {
    expect(() => computeConfidence(null, new Set())).not.toThrow();
    expect(computeConfidence(null, new Set()).band).toBeNull();
  });
});

describe('computeConfidence — band', () => {
  it('reliable: coverage >= 0.7 and domains >= 10', () => {
    const r = report({ focus: [sig('f', ['discoveries.rising.0:foo/bar'])], pulse: domainsN(10) });
    expect(computeConfidence(r, idSpace).band).toBe('reliable');
  });
  it('thin: coverage < 0.4', () => {
    const r = report({
      focus: [sig('a', []), sig('b', []), sig('c', ['discoveries.rising.0:foo/bar'])], // 1/3
      pulse: domainsN(10),
    });
    expect(computeConfidence(r, idSpace).band).toBe('thin');
  });
  it('thin: domain collapse (< 5) even with full coverage', () => {
    const r = report({ focus: [sig('f', ['discoveries.rising.0:foo/bar'])], pulse: domainsN(3) });
    expect(computeConfidence(r, idSpace).band).toBe('thin');
  });
  it('moderate: in between', () => {
    const r = report({
      focus: [sig('a', ['discoveries.rising.0:foo/bar']), sig('b', [])], // 1/2 = 0.5
      pulse: domainsN(7),
    });
    expect(computeConfidence(r, idSpace).band).toBe('moderate');
  });
});
