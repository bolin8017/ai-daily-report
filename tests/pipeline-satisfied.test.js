import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { satisfied } from '../src/pipeline/satisfied.js';

const TODAY = '2026-06-04';
let dir;
let staging;
let reports;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'satisfied-'));
  staging = path.join(dir, 'staging');
  reports = path.join(dir, 'reports');
  mkdirSync(path.join(staging, 'curated'), { recursive: true });
  mkdirSync(reports, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const opts = () => ({ today: TODAY, stagingDir: staging, reportsDir: reports });

// utimesSync sets atime/mtime in seconds; we pin them to make freshness deterministic.
function writeAt(p, content, mtimeSec) {
  writeFileSync(p, content);
  utimesSync(p, mtimeSec, mtimeSec);
}
const meta = (mt) =>
  writeAt(path.join(staging, 'metadata.json'), JSON.stringify({ date: TODAY }), mt);

describe('satisfied — collect (today-metadata)', () => {
  it('ok when metadata.date === today', () => {
    writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify({ date: TODAY }));
    expect(satisfied('collect', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it('wrong-day when metadata is from another day', () => {
    writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify({ date: '2026-06-03' }));
    expect(satisfied('collect', opts())).toEqual({ satisfied: false, reason: 'wrong-day' });
  });
  it('missing when no metadata', () => {
    expect(satisfied('collect', opts())).toEqual({ satisfied: false, reason: 'missing' });
  });
  it('invalid when metadata has no string date', () => {
    writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify({ foo: 1 }));
    expect(satisfied('collect', opts())).toEqual({ satisfied: false, reason: 'invalid' });
  });
  it('invalid when metadata is not an object', () => {
    writeFileSync(path.join(staging, 'metadata.json'), 'null');
    expect(satisfied('collect', opts())).toEqual({ satisfied: false, reason: 'invalid' });
  });
});

describe('satisfied — curate.market (fresh-outputs)', () => {
  it('ok when output exists, parses, and is newer than metadata', () => {
    meta(1000);
    writeAt(path.join(staging, 'curated', 'market.json'), JSON.stringify({ ma: [] }), 2000);
    expect(satisfied('curate.market', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it('missing when output absent', () => {
    meta(1000);
    expect(satisfied('curate.market', opts())).toEqual({ satisfied: false, reason: 'missing' });
  });
  it('invalid when output is not parseable JSON', () => {
    meta(1000);
    writeAt(path.join(staging, 'curated', 'market.json'), '{ not json', 2000);
    expect(satisfied('curate.market', opts())).toEqual({ satisfied: false, reason: 'invalid' });
  });
  it('stale when output predates this run (older than metadata)', () => {
    meta(2000);
    writeAt(path.join(staging, 'curated', 'market.json'), JSON.stringify({ ma: [] }), 1000);
    expect(satisfied('curate.market', opts())).toEqual({ satisfied: false, reason: 'stale' });
  });
  it('missing when the metadata anchor itself is absent', () => {
    writeAt(path.join(staging, 'curated', 'market.json'), JSON.stringify({ ma: [] }), 2000);
    expect(satisfied('curate.market', opts())).toEqual({ satisfied: false, reason: 'missing' });
  });
});

describe('satisfied — faithfulness (editorial-audited)', () => {
  it('ok when editorial carries a faithfulness audit', () => {
    writeFileSync(
      path.join(staging, 'editorial.json'),
      JSON.stringify({ faithfulness: { flagged: [] } }),
    );
    expect(satisfied('faithfulness', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it('ok when audit exists and editorial is newer than metadata', () => {
    meta(1000);
    writeAt(
      path.join(staging, 'editorial.json'),
      JSON.stringify({ faithfulness: { flagged: [] } }),
      2000,
    );
    expect(satisfied('faithfulness', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it('stale when a prior-run editorial carries an audit but predates this run', () => {
    // A leftover editorial from yesterday still has its faithfulness key, but
    // this run's synthesize will overwrite it un-audited. The audit must re-run,
    // so editorial older than the metadata anchor counts as unsatisfied.
    meta(2000);
    writeAt(
      path.join(staging, 'editorial.json'),
      JSON.stringify({ faithfulness: { flagged: [] } }),
      1000,
    );
    expect(satisfied('faithfulness', opts())).toEqual({ satisfied: false, reason: 'stale' });
  });
  it('unaudited when editorial lacks the audit block', () => {
    writeFileSync(path.join(staging, 'editorial.json'), JSON.stringify({ lead: {} }));
    expect(satisfied('faithfulness', opts())).toEqual({ satisfied: false, reason: 'unaudited' });
  });
  it('missing when editorial.json is absent', () => {
    expect(satisfied('faithfulness', opts())).toEqual({ satisfied: false, reason: 'missing' });
  });
});

describe('satisfied — merge (report-for-day)', () => {
  it("ok when today's report exists and is newer than metadata", () => {
    meta(1000);
    writeAt(path.join(reports, `${TODAY}.json`), JSON.stringify({ schema_version: 2.1 }), 2000);
    expect(satisfied('merge', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it("missing when today's report is absent", () => {
    meta(1000);
    expect(satisfied('merge', opts())).toEqual({ satisfied: false, reason: 'missing' });
  });
  it('invalid when the report exists but is unparseable', () => {
    meta(1000);
    writeAt(path.join(reports, `${TODAY}.json`), '{ not json', 2000);
    expect(satisfied('merge', opts())).toEqual({ satisfied: false, reason: 'invalid' });
  });

  it('stale when the report is older than this run', () => {
    meta(2000);
    writeAt(path.join(reports, `${TODAY}.json`), JSON.stringify({ schema_version: 2.1 }), 1000);
    expect(satisfied('merge', opts())).toEqual({ satisfied: false, reason: 'stale' });
  });

  // pipe-3: a report with no metadata anchor means staging was wiped or never
  // ran — "trusting" it let a bare --resume keep yesterday's report for today.
  // Without stale evidence the safe answer is not-satisfied: merge re-runs
  // (idempotent) or fails loudly on missing staging, never false success.
  it('not satisfied when report exists but there is no metadata anchor', () => {
    writeAt(path.join(reports, `${TODAY}.json`), JSON.stringify({ schema_version: 2.1 }), 2000);
    expect(satisfied('merge', opts())).toEqual({ satisfied: false, reason: 'no-anchor' });
  });
});

describe('satisfied — context (fresh-outputs, .md output)', () => {
  it('ok when report-context.md exists and is newer than metadata', () => {
    meta(1000);
    writeAt(path.join(staging, 'report-context.md'), '# ctx', 2000);
    expect(satisfied('context', opts())).toEqual({ satisfied: true, reason: 'ok' });
  });
  it('stale when report-context.md predates the run', () => {
    meta(2000);
    writeAt(path.join(staging, 'report-context.md'), '# ctx', 1000);
    expect(satisfied('context', opts())).toEqual({ satisfied: false, reason: 'stale' });
  });
});

describe('satisfied — guards', () => {
  it('throws when today is not provided', () => {
    expect(() => satisfied('collect', { stagingDir: staging })).toThrow(/today/);
  });
});
