// Unit tests for src/lib/seen-repos.js — the cross-day "already shown" ledger
// that powers the catalog-walk dedup. Path is overridable so tests never touch
// the real data/seen-repos.json or invoke git.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(loadSeenLedger(ledgerPath)).toEqual([]);
    expect(loadSeenSet(ledgerPath).size).toBe(0);
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

  it('falls back (returns []) when the local ledger is corrupt JSON', () => {
    writeFileSync(ledgerPath, '{ not valid json');
    expect(loadSeenLedger(ledgerPath)).toEqual([]);
  });
});

describe('appendSeen', () => {
  it('adds only unseen repos and is idempotent on re-add', () => {
    const r1 = appendSeen(
      [
        { repo: 'a/b', stars: 30000 },
        { repo: 'c/d', stars: 40000 },
      ],
      '2026-06-08',
      ledgerPath,
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
    );
    expect(r.added).toBe(1);
    expect(loadSeenSet(ledgerPath).has('g/h')).toBe(true);
  });

  it('throws on a non-YYYY-MM-DD date rather than writing a corrupting entry', () => {
    expect(() =>
      appendSeen([{ repo: 'a/b', stars: 1 }], '2026-06-08T00:00:00Z', ledgerPath),
    ).toThrow(/YYYY-MM-DD/);
  });
});
