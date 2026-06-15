import { describe, expect, it } from 'vitest';
import { BENCH_LEADERBOARD_URL, benchOf } from '../src/lib/leaderboard-urls.js';

describe('benchOf', () => {
  it('resolves bfcl by explicit bench field', () => {
    expect(benchOf({ bench: 'bfcl' })).toBe('bfcl');
  });

  it('resolves bfcl by the title token when bench is absent', () => {
    expect(benchOf({ title: 'BFCL: function-calling parity across vendors' })).toBe('bfcl');
  });

  it('resolves lmarena by explicit bench field', () => {
    expect(benchOf({ bench: 'lmarena' })).toBe('lmarena');
  });

  it('resolves lmarena by title token', () => {
    expect(benchOf({ title: 'LMArena: Claude Fable 5 reclaims top spot' })).toBe('lmarena');
    expect(benchOf({ title: 'Chatbot Arena: new rankings out' })).toBe('lmarena');
  });

  it('returns null for an unknown / ghost benchmark', () => {
    expect(benchOf({ title: 'MTEB Leaderboard: Claude models dominate embeddings' })).toBeNull();
    expect(benchOf({ title: 'Some unrelated tech headline' })).toBeNull();
    expect(benchOf({})).toBeNull();
  });

  it('returns null for removed boards (swebench / ocrbench / aider)', () => {
    // These were removed 2026-06-15; curator items for them get URL stripped by merge
    expect(benchOf({ bench: 'swebench' })).toBeNull();
    expect(benchOf({ bench: 'ocrbench' })).toBeNull();
    expect(benchOf({ bench: 'aider' })).toBeNull();
    expect(benchOf({ title: 'OCRBench: Nemotron Nano VL 8B leads' })).toBeNull();
    expect(benchOf({ title: 'SWE-Bench Verified: Opus 4.5 #1' })).toBeNull();
    expect(benchOf({ title: 'Aider polyglot: Opus 4.5 tops code editing' })).toBeNull();
  });

  it('ignores an unknown explicit bench, falling back to the title token', () => {
    expect(benchOf({ bench: 'mteb', title: 'BFCL: x' })).toBe('bfcl');
    expect(benchOf({ bench: 'mteb', title: 'no recognizable token' })).toBeNull();
  });

  it('resolves swebench-live by explicit bench field', () => {
    expect(benchOf({ bench: 'swebench-live' })).toBe('swebench-live');
  });

  it('resolves swebench-live by title token', () => {
    expect(benchOf({ title: 'SWE-bench Live: GPT-5.5 leads verified split' })).toBe(
      'swebench-live',
    );
    expect(benchOf({ title: 'SWEbench-Live results out' })).toBe('swebench-live');
  });

  it('resolves tau2 by explicit bench field', () => {
    expect(benchOf({ bench: 'tau2' })).toBe('tau2');
  });

  it('resolves tau2 by title token', () => {
    expect(benchOf({ title: 'tau2-bench: agent tool-use rankings updated' })).toBe('tau2');
    expect(benchOf({ title: 'tau-bench new results' })).toBe('tau2');
  });

  it('every known bench maps to a canonical https url', () => {
    expect(Object.keys(BENCH_LEADERBOARD_URL).sort()).toEqual([
      'bfcl',
      'epoch-gpqa',
      'epoch-hle',
      'livebench',
      'lmarena',
      'swebench-live',
      'tau2',
    ]);
    for (const url of Object.values(BENCH_LEADERBOARD_URL)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});
