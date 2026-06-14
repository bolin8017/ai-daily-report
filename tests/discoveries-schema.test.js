import { describe, expect, it } from 'vitest';
import { DiscoveriesStagingSchema } from '../src/schemas/discoveries.js';

const candidate = {
  full_name: 'o/r',
  url: 'https://github.com/o/r',
  stars: 120,
  stars_today: 40,
  velocity_per_day: 10,
  repo_age_days: 7,
  eng_score: 4,
  eng_signals: { tests: true, ci: true, types: false, lint: true, lockfile: true, layout: true, docs: false, codeSubstance: true },
  validation_refs: ['hacker-news'],
  excellence_score: 0.62,
  source: 'github-search',
};

describe('DiscoveriesStagingSchema', () => {
  it('accepts a well-formed file', () => {
    expect(() =>
      DiscoveriesStagingSchema.parse({ ok: true, generated_at: '2026-06-15T00:00:00Z', candidates: [candidate], watchlist: [], stats: { pool: 200, survivors: 1, watchlisted: 0 } }),
    ).not.toThrow();
  });
  it('rejects a candidate missing full_name', () => {
    const bad = { ...candidate };
    delete bad.full_name;
    expect(() => DiscoveriesStagingSchema.parse({ ok: true, generated_at: 'x', candidates: [bad], watchlist: [], stats: { pool: 0, survivors: 0, watchlisted: 0 } })).toThrow();
  });
});
