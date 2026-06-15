import { describe, expect, it } from 'vitest';
import { rankGaia } from '../src/fetchers/providers/leaderboards-parsers/gaia.js';

describe('rankGaia', () => {
  it('ranks by score desc, best score per model, deduped', () => {
    const rows = [
      { model: 'X', score: 0.1 },
      { model: 'Y', score: 0.9 },
      { model: 'X', score: 0.5 },
    ];
    const out = rankGaia(rows);
    expect(out[0]).toMatchObject({ model_id: 'Y', rank: 1 });
    expect(out[1]).toMatchObject({ model_id: 'X', rank: 2 });
    expect(out.find((e) => e.model_id === 'X').score).toBe(0.5); // best per model kept
    expect(out).toHaveLength(2);
  });
  it('skips rows with missing model or non-numeric score', () => {
    const out = rankGaia([
      { model: '', score: 0.5 },
      { model: 'Z', score: null },
      { model: 'W', score: 0.3 },
    ]);
    expect(out).toEqual([{ model_id: 'W', score: 0.3, rank: 1 }]);
  });
  it('returns [] for empty input', () => {
    expect(rankGaia([])).toEqual([]);
  });
});
