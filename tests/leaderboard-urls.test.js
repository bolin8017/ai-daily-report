import { describe, expect, it } from 'vitest';
import { BENCH_LEADERBOARD_URL, benchOf } from '../src/lib/leaderboard-urls.js';

describe('benchOf', () => {
  it('resolves by explicit bench field', () => {
    expect(benchOf({ bench: 'bfcl' })).toBe('bfcl');
    expect(benchOf({ bench: 'swebench' })).toBe('swebench');
    expect(benchOf({ bench: 'ocrbench' })).toBe('ocrbench');
  });

  it('resolves by the title token when bench is absent', () => {
    expect(benchOf({ title: 'OCRBench: Nemotron Nano VL 8B leads' })).toBe('ocrbench');
    expect(benchOf({ title: 'BFCL: function-calling parity across vendors' })).toBe('bfcl');
    expect(benchOf({ title: 'SWE-Bench Verified: Opus 4.5 #1' })).toBe('swebench');
    expect(benchOf({ title: 'SWEbench: collapsed spelling still matches' })).toBe('swebench');
    expect(benchOf({ title: 'Aider polyglot: Opus 4.5 tops code editing' })).toBe('aider');
  });

  it('returns null for an unknown / ghost benchmark', () => {
    expect(benchOf({ title: 'MTEB Leaderboard: Claude models dominate embeddings' })).toBeNull();
    expect(benchOf({ title: 'Some unrelated tech headline' })).toBeNull();
    expect(benchOf({})).toBeNull();
  });

  it('ignores an unknown explicit bench, falling back to the title token', () => {
    expect(benchOf({ bench: 'mteb', title: 'OCRBench: x' })).toBe('ocrbench');
    expect(benchOf({ bench: 'mteb', title: 'no recognizable token' })).toBeNull();
  });

  it('every known bench maps to a canonical https url', () => {
    expect(Object.keys(BENCH_LEADERBOARD_URL).sort()).toEqual([
      'aider',
      'bfcl',
      'ocrbench',
      'swebench',
    ]);
    for (const url of Object.values(BENCH_LEADERBOARD_URL)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});
