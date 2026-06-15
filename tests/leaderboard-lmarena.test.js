import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLmarena } from '../src/fetchers/providers/leaderboards-parsers/lmarena.js';

describe('parseLmarena', () => {
  const txt = readFileSync('tests/fixtures/leaderboards/lmarena-text.json', 'utf8');
  it('ranks models by rank with model_id/score', () => {
    const out = parseLmarena(txt);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatchObject({ rank: 1 });
    expect(typeof out[0].model_id).toBe('string');
    expect(typeof out[0].score).toBe('number');
    expect(out[0].rank).toBeLessThan(out[1].rank);
  });

  it('returns [] when there are no models', () => {
    expect(parseLmarena('{}')).toEqual([]);
  });
});
