// Regression tests for the ops-2 finding (2026-07-21 operational reliability
// review): 2026-07-02/03 had no run, no notice, no report — nothing anywhere
// noticed the calendar gap. The gap check diffs recent calendar days against
// the reports actually present on origin/data and surfaces missing days in
// the run state + delivery notices.

import { describe, expect, it } from 'vitest';
import { findMissingReportDays, parseReportDates, scanReportGaps } from '../src/ops/report-gaps.js';

describe('parseReportDates', () => {
  it('extracts dates from git ls-tree output, ignoring non-report paths', () => {
    const lsTree = [
      'data/reports/2026-07-19.json',
      'data/reports/2026-07-20.json',
      'data/reports/lenses/2026-05-01.json',
      'data/feeds-snapshot.json',
      'data/reports/notes.txt',
      '',
    ].join('\n');
    expect(parseReportDates(lsTree)).toEqual(['2026-07-19', '2026-07-20']);
  });
});

describe('findMissingReportDays', () => {
  const days = (...d) => d;

  it('returns [] when every day in the window has a report', () => {
    const present = days('2026-07-18', '2026-07-19', '2026-07-20');
    expect(
      findMissingReportDays({ presentDates: present, today: '2026-07-21', lookbackDays: 3 }),
    ).toEqual([]);
  });

  it('reports holes inside the window (the 07-02/07-03 production case)', () => {
    const present = days('2026-06-29', '2026-07-01', '2026-07-04', '2026-07-05', '2026-07-06');
    expect(
      findMissingReportDays({ presentDates: present, today: '2026-07-07', lookbackDays: 6 }),
    ).toEqual(['2026-07-02', '2026-07-03']);
  });

  it('excludes today (the running day is the run’s own job)', () => {
    expect(
      findMissingReportDays({ presentDates: [], today: '2026-07-21', lookbackDays: 2 }),
    ).toEqual(['2026-07-19', '2026-07-20']);
  });

  it('ignores reports outside the lookback window', () => {
    const present = days('2026-01-01');
    expect(
      findMissingReportDays({ presentDates: present, today: '2026-07-21', lookbackDays: 1 }),
    ).toEqual(['2026-07-20']);
  });

  it('crosses month boundaries correctly', () => {
    expect(
      findMissingReportDays({ presentDates: [], today: '2026-07-01', lookbackDays: 2 }),
    ).toEqual(['2026-06-29', '2026-06-30']);
  });
});

describe('scanReportGaps', () => {
  it('skips the scan when the listing is unavailable (git failure)', () => {
    // dr-2 (2026-07-22 review): a failed fetch/ls-tree used to look like an
    // empty branch, flooding the notice with all 14 lookback days "missing".
    expect(scanReportGaps({ listing: null, today: '2026-07-22' })).toEqual({
      skipped: true,
      missingDays: null,
    });
  });

  it('scans normally on a real listing', () => {
    const listing = ['data/reports/2026-07-20.json', 'data/reports/2026-07-22.json'].join('\n');
    expect(scanReportGaps({ listing, today: '2026-07-22', lookbackDays: 2 })).toEqual({
      skipped: false,
      missingDays: ['2026-07-21'],
    });
  });

  it('still scans an empty-but-successful listing (bootstrap data branch)', () => {
    expect(scanReportGaps({ listing: '', today: '2026-07-22', lookbackDays: 1 })).toEqual({
      skipped: false,
      missingDays: ['2026-07-21'],
    });
  });
});
