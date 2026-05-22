import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/fetchers/providers/leaderboards-parsers/_base.js';

describe('diffSnapshots', () => {
  const prev = [
    { model_id: 'a', rank: 1, score: 90 },
    { model_id: 'b', rank: 2, score: 88 },
    { model_id: 'c', rank: 3, score: 85 },
    { model_id: 'd', rank: 4, score: 80 },
    { model_id: 'e', rank: 5, score: 78 },
  ];

  it('treats first-ever snapshot (prev=null) as all-new', () => {
    const d = diffSnapshots(null, prev);
    expect(d.new_top_5).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(d.rank_changes).toEqual([]);
  });

  it('detects new top-5 entry', () => {
    const curr = [
      { model_id: 'f', rank: 1, score: 92 },
      { model_id: 'a', rank: 2, score: 90 },
      { model_id: 'b', rank: 3, score: 88 },
      { model_id: 'c', rank: 4, score: 85 },
      { model_id: 'd', rank: 5, score: 80 },
    ];
    const d = diffSnapshots(prev, curr);
    expect(d.new_top_5).toContain('f');
  });

  it('detects rank changes', () => {
    const curr = [
      { model_id: 'a', rank: 1, score: 91 },
      { model_id: 'c', rank: 2, score: 89 },
      { model_id: 'b', rank: 3, score: 88 },
      { model_id: 'd', rank: 4, score: 80 },
      { model_id: 'e', rank: 5, score: 78 },
    ];
    const d = diffSnapshots(prev, curr);
    expect(d.rank_changes.some((s) => s.includes('c'))).toBe(true);
  });

  it('no changes returns empty arrays', () => {
    const d = diffSnapshots(prev, prev);
    expect(d.new_top_5).toEqual([]);
    expect(d.rank_changes).toEqual([]);
  });
});
