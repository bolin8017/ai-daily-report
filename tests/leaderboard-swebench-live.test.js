import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSwebenchLive } from '../src/fetchers/providers/leaderboards-parsers/swebench-live.js';

describe('parseSwebenchLive', () => {
  const jsonl = readFileSync('tests/fixtures/leaderboards/swebench-live.jsonl', 'utf8');
  it('ranks the verified split by resolved %', () => {
    const out = parseSwebenchLive(jsonl);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].rank).toBe(1);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    expect(typeof out[0].model_id).toBe('string');
  });
  it('falls back to lite when verified is absent', () => {
    const liteOnly =
      '{"name":"X","set":"lite","total":10,"resolved":5}\n{"name":"Y","set":"lite","total":10,"resolved":8}';
    const out = parseSwebenchLive(liteOnly);
    expect(out[0].model_id).toBe('Y'); // 80% > 50%
  });
  it('returns [] for empty input', () => {
    expect(parseSwebenchLive('')).toEqual([]);
  });
});
