// tests/leaderboard-snapshots.test.js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrev, loadSnapshots, saveSnapshot } from '../src/lib/leaderboard-snapshots.js';

describe('leaderboard-snapshots', () => {
  let dir, path;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lb-'));
    path = join(dir, 'snap.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for an unknown bench (cold start)', () => {
    expect(getPrev('bfcl', path)).toBeNull();
  });

  it('round-trips a saved ranking', () => {
    const ranking = [
      { model_id: 'A', rank: 1, score: 90 },
      { model_id: 'B', rank: 2, score: 80 },
    ];
    saveSnapshot('bfcl', ranking, path);
    expect(getPrev('bfcl', path)).toEqual(ranking);
  });

  it('keeps benches independent in one file', () => {
    saveSnapshot('bfcl', [{ model_id: 'A', rank: 1, score: 1 }], path);
    saveSnapshot('lmarena', [{ model_id: 'X', rank: 1, score: 1 }], path);
    expect(loadSnapshots(path)).toHaveProperty('bfcl');
    expect(loadSnapshots(path)).toHaveProperty('lmarena');
  });
});
