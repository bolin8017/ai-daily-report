// Unit tests for src/lib/seen-repos.js — the cross-day "already shown" ledger
// behind the 新發現 (discoveries) dedup. Path is overridable and the data-branch
// reader is injectable, so tests never touch the real data/seen-repos.json and
// never shell out to git.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendSeen, loadSeenLedger, loadSeenSet, SeenReposSchema } from '../src/lib/seen-repos.js';

let dir;
let ledgerPath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seen-repos-'));
  ledgerPath = join(dir, 'seen-repos.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SeenReposSchema', () => {
  it('accepts a well-formed ledger and rejects a malformed entry', () => {
    expect(() =>
      SeenReposSchema.parse([{ repo: 'a/b', first_shown: '2026-06-08', stars_at_show: 31000 }]),
    ).not.toThrow();
    expect(() => SeenReposSchema.parse([{ repo: 'a/b', first_shown: 'nope' }])).toThrow();
  });
});

describe('loadSeenLedger / loadSeenSet', () => {
  it('returns [] / empty set when the ledger file is absent', () => {
    const branchRead = () => ({ status: 'absent' });
    expect(loadSeenLedger(ledgerPath, { branchRead })).toEqual([]);
    expect(loadSeenSet(ledgerPath, { branchRead }).size).toBe(0);
  });

  it('reads an existing local ledger into a Set of repo keys', () => {
    writeFileSync(
      ledgerPath,
      JSON.stringify([
        { repo: 'pytorch/pytorch', first_shown: '2026-06-08', stars_at_show: 80000 },
      ]),
    );
    expect(loadSeenSet(ledgerPath).has('pytorch/pytorch')).toBe(true);
  });

  // Review finding merge-2: after a completed day, a full re-run of the same
  // date must not treat today's own picks as "seen" — otherwise the
  // regenerated report's discoveries sections come out empty.
  it('excludes entries first shown on/after shownBefore (same-day regeneration)', () => {
    writeFileSync(
      ledgerPath,
      JSON.stringify([
        { repo: 'a/b', first_shown: '2026-07-20', stars_at_show: 10 },
        { repo: 'c/d', first_shown: '2026-07-21', stars_at_show: 20 },
      ]),
    );
    expect(loadSeenSet(ledgerPath, { shownBefore: '2026-07-21' })).toEqual(new Set(['a/b']));
    expect(loadSeenSet(ledgerPath)).toEqual(new Set(['a/b', 'c/d']));
  });

  it('recovers a corrupt local ledger from the data branch', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    const branch = [{ repo: 'a/b', first_shown: '2026-08-01', stars_at_show: 5 }];
    expect(
      loadSeenSet(ledgerPath, {
        branchRead: () => ({ status: 'ok', raw: JSON.stringify(branch) }),
      }),
    ).toEqual(new Set(['a/b']));
  });

  // Read-side degradation is deliberate and mirrors loadStarHistory: an
  // unreadable ledger yields an empty set so the funnel still runs. The guard
  // that matters lives on the WRITE side — see the appendSeen block below.
  it('yields an empty set when nothing is readable, without claiming a cold start', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    expect(
      loadSeenSet(ledgerPath, { branchRead: () => ({ status: 'error', detail: 'no ref' }) }).size,
    ).toBe(0);
  });
});

describe('appendSeen', () => {
  // No local file and no branch ledger — a genuine cold start, so the write
  // proceeds. Injected so the test never shells out to git.
  const coldStart = { branchRead: () => ({ status: 'absent' }) };

  it('adds only unseen repos and is idempotent on re-add', () => {
    const r1 = appendSeen(
      [
        { repo: 'a/b', stars: 30000 },
        { repo: 'c/d', stars: 40000 },
      ],
      '2026-06-08',
      ledgerPath,
      coldStart,
    );
    expect(r1).toEqual({ added: 2, total: 2 });
    const r2 = appendSeen(
      [
        { repo: 'a/b', stars: 30000 },
        { repo: 'e/f', stars: 50000 },
      ],
      '2026-06-09',
      ledgerPath,
    );
    expect(r2).toEqual({ added: 1, total: 3 });
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    expect(ledger.map((e) => e.repo)).toEqual(['a/b', 'c/d', 'e/f']);
    expect(ledger[2]).toMatchObject({
      repo: 'e/f',
      first_shown: '2026-06-09',
      stars_at_show: 50000,
    });
  });

  it('accepts items keyed by full_name and ignores keyless items', () => {
    const r = appendSeen(
      [{ full_name: 'g/h', stars: 31000 }, { stars: 1 }],
      '2026-06-08',
      ledgerPath,
      coldStart,
    );
    expect(r.added).toBe(1);
    expect(loadSeenSet(ledgerPath, coldStart).has('g/h')).toBe(true);
  });

  it('throws on a non-YYYY-MM-DD date rather than writing a corrupting entry', () => {
    expect(() =>
      appendSeen([{ repo: 'a/b', stars: 1 }], '2026-06-08T00:00:00Z', ledgerPath, coldStart),
    ).toThrow(/YYYY-MM-DD/);
  });
});

// Review finding led-1 (2026-08-07 review): appendSeen must not replace the
// accrued cross-day ledger with a today-only file when the prior state exists
// but could not be read. Stage 4 commits data/seen-repos.json to the data
// branch every run, so that write destroys the whole dedup history and the
// 新發現 tab starts re-surfacing repos it already published. #127 gave this
// guard to star-history and leaderboard-snapshots but not to this ledger.
describe('appendSeen with unreadable prior state', () => {
  const picks = [{ repo: 'x/y', stars: 10 }];

  it('refuses a fresh write when the data-branch ref is unavailable', () => {
    const r = appendSeen(picks, '2026-08-07', ledgerPath, {
      branchRead: () => ({ status: 'error', detail: 'refs/remotes/origin/data not present' }),
    });
    expect(r.skipped).toBe(true);
    expect(r.added).toBe(0);
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it('refuses to overwrite a corrupt local ledger', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    const r = appendSeen(picks, '2026-08-07', ledgerPath, {
      branchRead: () => ({ status: 'error', detail: 'git failed' }),
    });
    expect(r.skipped).toBe(true);
    expect(readFileSync(ledgerPath, 'utf8')).toBe('{ not valid json');
  });

  it('refuses when a local ledger exists but the branch has none (state unknowable)', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    const r = appendSeen(picks, '2026-08-07', ledgerPath, {
      branchRead: () => ({ status: 'absent' }),
    });
    expect(r.skipped).toBe(true);
    expect(readFileSync(ledgerPath, 'utf8')).toBe('{ not valid json');
  });

  it('still writes on a genuine cold start (no local file, no branch ledger)', () => {
    const r = appendSeen(picks, '2026-08-07', ledgerPath, {
      branchRead: () => ({ status: 'absent' }),
    });
    expect(r).toEqual({ added: 1, total: 1 });
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8'))).toHaveLength(1);
  });

  it('recovers the ledger from the data branch when the local copy is corrupt', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    const branch = [{ repo: 'a/b', first_shown: '2026-08-01', stars_at_show: 5 }];
    const r = appendSeen(picks, '2026-08-07', ledgerPath, {
      branchRead: () => ({ status: 'ok', raw: JSON.stringify(branch) }),
    });
    expect(r).toEqual({ added: 1, total: 2 });
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).map((e) => e.repo)).toEqual(['a/b', 'x/y']);
  });
});
