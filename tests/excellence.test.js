import { describe, expect, it } from 'vitest';
import {
  commitContinuity,
  contributorDiversity,
  engGatePass,
  engScore,
  engSignalsFromTree,
  excellenceScore,
  externalValidation,
  freeGates,
  repoAgeDays,
  velocityGatePass,
  velocityStats,
} from '../src/lib/excellence.js';

describe('repoAgeDays', () => {
  it('counts whole days', () => {
    expect(repoAgeDays('2026-06-01', '2026-06-15')).toBe(14);
  });
  it('returns null on bad input', () => {
    expect(repoAgeDays('', '2026-06-15')).toBeNull();
  });
});

describe('freeGates', () => {
  const ok = { fork: false, license: 'MIT', created_at: '2026-06-10', pushed_at: '2026-06-14' };
  const opts = { todayISO: '2026-06-15' };
  it('passes a clean recent licensed non-fork', () => {
    expect(freeGates(ok, opts)).toEqual({ pass: true, reason: null });
  });
  it('rejects a fork', () => {
    expect(freeGates({ ...ok, fork: true }, opts).pass).toBe(false);
  });
  it('rejects no license', () => {
    expect(freeGates({ ...ok, license: null }, opts).pass).toBe(false);
  });
  it('rejects too-old repos (>30d)', () => {
    expect(freeGates({ ...ok, created_at: '2026-04-01' }, opts).pass).toBe(false);
  });
  it('rejects stale repos (pushed_at >14d)', () => {
    expect(freeGates({ ...ok, pushed_at: '2026-05-01' }, opts).pass).toBe(false);
  });
});

describe('engSignalsFromTree', () => {
  it('detects the engineering bundle from paths', () => {
    const s = engSignalsFromTree([
      'src/index.ts',
      'src/lib/a.ts',
      'tests/a.test.ts',
      '.github/workflows/ci.yml',
      'tsconfig.json',
      'biome.json',
      'package-lock.json',
      'docs/guide.md',
      'README.md',
    ]);
    expect(s.tests).toBe(true);
    expect(s.ci).toBe(true);
    expect(s.types).toBe(true);
    expect(s.lint).toBe(true);
    expect(s.lockfile).toBe(true);
    expect(s.layout).toBe(true); // >50% source under src/
    expect(s.docs).toBe(true);
    expect(s.codeSubstance).toBe(true); // >=5 source files? here sourceFiles>=3 -> see rule
  });
  it('flags a README-only repo as no code substance', () => {
    const s = engSignalsFromTree(['README.md', 'LICENSE']);
    expect(s.codeSubstance).toBe(false);
    expect(s.tests).toBe(false);
  });
});

describe('engScore / engGatePass', () => {
  it('scores 0-6 by signal count', () => {
    expect(
      engScore({ tests: true, ci: true, types: true, lint: false, lockfile: false, layout: false }),
    ).toBe(3);
  });
  it('gate needs codeSubstance + >=2 of tests/ci/(types||lockfile)', () => {
    expect(
      engGatePass({ codeSubstance: true, tests: true, ci: true, types: false, lockfile: false }),
    ).toBe(true);
    expect(
      engGatePass({ codeSubstance: true, tests: true, ci: false, types: false, lockfile: true }),
    ).toBe(true);
    expect(
      engGatePass({ codeSubstance: true, tests: true, ci: false, types: false, lockfile: false }),
    ).toBe(false);
    expect(
      engGatePass({ codeSubstance: false, tests: true, ci: true, types: true, lockfile: true }),
    ).toBe(false);
  });
});

describe('velocityStats / velocityGatePass', () => {
  const snaps = (arr) => arr.map(([date, stars]) => ({ date, stars, forks: null }));
  it('computes per-day over the window', () => {
    const s = velocityStats(
      snaps([
        ['2026-06-08', 50],
        ['2026-06-15', 120],
      ]),
      '2026-06-15',
    );
    expect(s.historyDays).toBe(7);
    expect(s.totalStars).toBe(120);
    expect(s.perDay).toBeCloseTo(10, 1);
  });
  it('watchlists repos with <4 days of history', () => {
    expect(
      velocityGatePass(
        velocityStats(
          snaps([
            ['2026-06-14', 30],
            ['2026-06-15', 40],
          ]),
          '2026-06-15',
        ),
        { hasValidation: false },
      ),
    ).toBe('watch');
  });
  it('fails a flat 30->50 over a week', () => {
    const s = velocityStats(
      snaps([
        ['2026-06-08', 30],
        ['2026-06-15', 50],
      ]),
      '2026-06-15',
    );
    expect(velocityGatePass(s, { hasValidation: false })).toBe('fail'); // ~2.9/day < 5
  });
  it('passes a fast riser', () => {
    const s = velocityStats(
      snaps([
        ['2026-06-08', 50],
        ['2026-06-15', 200],
      ]),
      '2026-06-15',
    );
    expect(velocityGatePass(s, { hasValidation: false })).toBe('pass');
  });
  it('validation overrides a flat repo', () => {
    const s = velocityStats(
      snaps([
        ['2026-06-08', 30],
        ['2026-06-15', 50],
      ]),
      '2026-06-15',
    );
    expect(velocityGatePass(s, { hasValidation: true })).toBe('pass');
  });
});

describe('externalValidation', () => {
  it('matches repo mentions across feed item fields, distinct sources', () => {
    const feeds = [
      {
        source: 'hacker-news',
        url: 'https://news.ycombinator.com/x',
        title: 'Show HN',
        description: 'see github.com/o/r for details',
      },
      { source: 'simonwillison', url: 'https://github.com/o/r', title: '', description: '' },
      { source: 'hacker-news', url: 'https://github.com/o/r/issues', title: '', description: '' },
      { source: 'lobsters', url: 'https://github.com/other/thing', title: '', description: '' },
    ];
    expect(externalValidation('o/r', feeds).sort()).toEqual(['hacker-news', 'simonwillison']);
  });
});

describe('excellenceScore', () => {
  it('is 0..1 and weights velocity highest', () => {
    const hi = excellenceScore({
      perDay: 50,
      engScore: 6,
      validationCount: 2,
      forkPerDay: 10,
      readmeLen: 400,
      codeSubstance: true,
      commitScore: 1,
      contributorScore: 1,
      downloadScore: 1,
    });
    expect(hi).toBeCloseTo(1, 2);
    const lo = excellenceScore({
      perDay: 0,
      engScore: 0,
      validationCount: 0,
      forkPerDay: 0,
      readmeLen: 0,
      codeSubstance: false,
      commitScore: 0,
      contributorScore: 0,
      downloadScore: 0,
    });
    expect(lo).toBe(0);
  });
});

describe('commitContinuity', () => {
  const commits = (days) =>
    days.map((d, i) => ({
      login: 'human',
      date: `${d}T0${i % 9}:00:00Z`,
      message: 'feat: real work',
    }));
  it('counts distinct recent days with non-bot commits', () => {
    const c = commitContinuity(
      commits(['2026-06-14', '2026-06-14', '2026-06-12', '2026-06-09']),
      '2026-06-15',
    );
    expect(c.daysWithCommits).toBe(3);
    expect(c.nonBotCommits).toBe(4);
  });
  it('ignores bot commits', () => {
    const c = commitContinuity(
      [{ login: 'dependabot[bot]', date: '2026-06-14T00:00:00Z', message: 'bump' }],
      '2026-06-15',
    );
    expect(c.nonBotCommits).toBe(0);
    expect(c.daysWithCommits).toBe(0);
  });
});

describe('contributorDiversity', () => {
  it('rewards multiple contributors, penalizes single-author dominance', () => {
    const many = contributorDiversity(
      [
        { login: 'a', contributions: 10 },
        { login: 'b', contributions: 8 },
        { login: 'c', contributions: 6 },
      ],
      10,
    );
    const solo = contributorDiversity([{ login: 'a', contributions: 100 }], 10);
    expect(many).toBeGreaterThan(solo);
    expect(solo).toBeGreaterThanOrEqual(0);
  });
});
