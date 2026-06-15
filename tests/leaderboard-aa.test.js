import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAa } from '../src/fetchers/providers/leaderboards-parsers/artificial-analysis.js';

describe('parseAa', () => {
  const json = JSON.parse(readFileSync('tests/fixtures/leaderboards/aa.json', 'utf8'));
  it('ranks models by intelligence index desc, dropping null-index models', () => {
    const out = parseAa(json);
    expect(out[0]).toMatchObject({ rank: 1 });
    expect(out[0].model_id).toContain('Claude Fable 5');
    expect(out[0].score).toBe(64.9);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    // the null-index model (GPT-5.5 Pro) is filtered out → 5 of 6 rows remain
    expect(out.find((e) => e.model_id.includes('GPT-5.5 Pro'))).toBeUndefined();
    expect(out).toHaveLength(5);
  });
  it('returns [] for a payload with no data', () => {
    expect(parseAa({ data: [] })).toEqual([]);
    expect(parseAa({})).toEqual([]);
  });
});
