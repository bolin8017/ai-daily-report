import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateTau2 } from '../src/fetchers/providers/leaderboards-parsers/tau2.js';

describe('aggregateTau2', () => {
  it('ranks by mean pass_1 across domains', () => {
    const subs = [
      JSON.parse(readFileSync('tests/fixtures/leaderboards/tau2-sub-A.json', 'utf8')),
      JSON.parse(readFileSync('tests/fixtures/leaderboards/tau2-sub-B.json', 'utf8')),
    ];
    const out = aggregateTau2(subs);
    expect(out.length).toBe(2);
    expect(out[0].rank).toBe(1);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    expect(typeof out[0].model_id).toBe('string');
  });
  it('averages only finite pass_1 values, ignoring null domains', () => {
    const subs = [
      { model_name: 'X', results: { a: { pass_1: 80 }, b: { pass_1: null }, c: { pass_1: 40 } } },
    ];
    const out = aggregateTau2(subs);
    expect(out[0].score).toBe(60); // mean of 80 and 40, null ignored
  });
  it('drops a submission with no finite pass_1', () => {
    expect(aggregateTau2([{ model_name: 'Y', results: { a: { pass_1: null } } }])).toEqual([]);
  });
  it('returns [] for empty input', () => {
    expect(aggregateTau2([])).toEqual([]);
  });
});
