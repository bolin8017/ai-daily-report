import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLivebench } from '../src/fetchers/providers/leaderboards-parsers/livebench.js';

describe('parseLivebench', () => {
  const csv = readFileSync('tests/fixtures/leaderboards/livebench-table.csv', 'utf8');
  it('ranks models by mean task score', () => {
    const out = parseLivebench(csv);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].rank).toBe(1);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    expect(typeof out[0].model_id).toBe('string');
  });
  it('returns [] for empty input', () => {
    expect(parseLivebench('')).toEqual([]);
  });
});
