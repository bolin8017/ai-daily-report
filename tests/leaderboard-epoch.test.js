import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEpoch } from '../src/fetchers/providers/leaderboards-parsers/epoch.js';

describe('parseEpoch', () => {
  const csv = readFileSync('tests/fixtures/leaderboards/epoch.csv', 'utf8');
  it('builds a ranked GPQA board, best score per model, deduped', () => {
    const out = parseEpoch(csv, 'GPQA diamond');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].rank).toBe(1);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    const ids = out.map((e) => e.model_id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate models
  });
  it('filters by benchmark independently (HLE non-empty, different from GPQA)', () => {
    expect(parseEpoch(csv, 'HLE').length).toBeGreaterThan(0);
  });
  it('returns [] for an unknown benchmark', () => {
    expect(parseEpoch(csv, 'NoSuchBench')).toEqual([]);
  });
});
