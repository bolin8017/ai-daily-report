import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStarHistory, pruneStarHistory, recordSnapshot } from '../src/lib/star-history.js';

let dir;
let path;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'star-history-'));
  path = join(dir, 'star-history.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadStarHistory', () => {
  it('returns {} when absent', () => {
    expect(loadStarHistory(path)).toEqual({});
  });
  it('returns {} on corrupt JSON (no git fallback in a tmp dir)', () => {
    writeFileSync(path, '{ not json');
    expect(loadStarHistory(path)).toEqual({});
  });
});

describe('recordSnapshot', () => {
  it('seeds first_seen and records one snapshot per repo', () => {
    const r = recordSnapshot(
      [
        { full_name: 'a/b', stars: 40, forks: 3 },
        { name: 'c', url: 'https://github.com/o/c', stars: 120 },
      ],
      '2026-06-15',
      path,
    );
    expect(r).toEqual({ recorded: 2, repos: 2 });
    const h = JSON.parse(readFileSync(path, 'utf8'));
    expect(h['a/b']).toEqual({ first_seen: '2026-06-15', snapshots: [{ date: '2026-06-15', stars: 40, forks: 3 }] });
    expect(h['o/c'].snapshots[0]).toEqual({ date: '2026-06-15', stars: 120, forks: null });
  });

  it('is idempotent on the same date (overwrites, never duplicates)', () => {
    recordSnapshot([{ full_name: 'a/b', stars: 40 }], '2026-06-15', path);
    recordSnapshot([{ full_name: 'a/b', stars: 47 }], '2026-06-15', path);
    const h = JSON.parse(readFileSync(path, 'utf8'));
    expect(h['a/b'].snapshots).toEqual([{ date: '2026-06-15', stars: 47, forks: null }]);
    expect(h['a/b'].first_seen).toBe('2026-06-15');
  });

  it('appends a second-day snapshot and keeps first_seen', () => {
    recordSnapshot([{ full_name: 'a/b', stars: 40 }], '2026-06-15', path);
    recordSnapshot([{ full_name: 'a/b', stars: 90 }], '2026-06-16', path);
    const h = JSON.parse(readFileSync(path, 'utf8'));
    expect(h['a/b'].first_seen).toBe('2026-06-15');
    expect(h['a/b'].snapshots.map((s) => s.stars)).toEqual([40, 90]);
  });

  it('skips items with no derivable owner/repo or no numeric stars', () => {
    const r = recordSnapshot([{ name: 'bareslug', stars: 5 }, { full_name: 'a/b' }], '2026-06-15', path);
    expect(r.recorded).toBe(0);
  });

  it('throws on a non-YYYY-MM-DD date', () => {
    expect(() => recordSnapshot([{ full_name: 'a/b', stars: 1 }], '2026/06/15', path)).toThrow(/YYYY-MM-DD/);
  });
});

describe('pruneStarHistory', () => {
  it('drops snapshots older than the retention window and empties stale repos', () => {
    const h = {
      'a/b': { first_seen: '2026-05-01', snapshots: [
        { date: '2026-05-01', stars: 1, forks: null },
        { date: '2026-06-14', stars: 9, forks: null },
      ] },
      'c/d': { first_seen: '2026-05-01', snapshots: [{ date: '2026-05-01', stars: 1, forks: null }] },
    };
    const pruned = pruneStarHistory(h, '2026-06-15', 30);
    expect(pruned['a/b'].snapshots.map((s) => s.date)).toEqual(['2026-06-14']);
    expect(pruned['c/d']).toBeUndefined();
  });
});
