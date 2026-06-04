import { describe, expect, it } from 'vitest';
import { decideNotice, renderFailure, renderOrphan } from '../src/ops/production-run.js';

const START = '2026-06-05T07:00:00.000Z';
const startMs = Date.parse(START);
const min = (n) => startMs + n * 60_000;

function running(extra = {}) {
  return {
    status: 'running',
    run_id: '20260605070000',
    started_at: START,
    log_file: '/x.log',
    stages: {},
    ...extra,
  };
}

describe('decideNotice', () => {
  it('stays silent on a succeeded run (success is silent policy)', () => {
    expect(decideNotice({ status: 'succeeded', started_at: START }, { nowMs: min(90) })).toBeNull();
  });

  it('prints a failure notice once, then suppresses it', () => {
    const failed = {
      status: 'failed',
      run_id: 'r',
      report_date: '2026-06-05',
      rc: { final: 2 },
      stages: {},
    };
    const first = decideNotice(failed, { nowMs: min(20), delivered: {} });
    expect(first).toEqual({ marker: 'failed', text: expect.stringContaining('FAILED') });
    expect(decideNotice(failed, { nowMs: min(20), delivered: { failed: true } })).toBeNull();
  });

  it('is silent while a run is under 30 minutes', () => {
    expect(decideNotice(running(), { nowMs: min(29), delivered: {} })).toBeNull();
  });

  it('emits the 30m notice once past 30 minutes', () => {
    const n = decideNotice(running(), { nowMs: min(31), delivered: {} });
    expect(n.marker).toBe('30m');
    expect(n.text).toMatch(/still running after 31 minutes/);
    // already delivered → silent
    expect(decideNotice(running(), { nowMs: min(31), delivered: { '30m': true } })).toBeNull();
  });

  it('emits the 60m notice (priority over 30m) once past an hour', () => {
    const n = decideNotice(running(), { nowMs: min(61), delivered: { '30m': true } });
    expect(n.marker).toBe('60m');
    expect(
      decideNotice(running(), { nowMs: min(61), delivered: { '30m': true, '60m': true } }),
    ).toBeNull();
  });

  it('returns null for missing state or unparseable start time', () => {
    expect(decideNotice(null, { nowMs: min(90) })).toBeNull();
    expect(decideNotice(running({ started_at: 'not-a-date' }), { nowMs: min(90) })).toBeNull();
  });

  it('reports an orphan once when the runner pid is dead mid-run', () => {
    const n = decideNotice(running(), { nowMs: min(10), delivered: {}, pidAlive: false });
    expect(n.marker).toBe('orphan');
    expect(n.text).toMatch(/orphaned run/);
    // already delivered → silent
    expect(
      decideNotice(running(), { nowMs: min(10), delivered: { orphan: true }, pidAlive: false }),
    ).toBeNull();
  });

  it('orphan takes priority over the long-running notice', () => {
    // 90 min elapsed but the process is dead → orphan, not a 30m/60m notice
    const n = decideNotice(running(), { nowMs: min(90), delivered: {}, pidAlive: false });
    expect(n.marker).toBe('orphan');
  });

  it('a live long-running process still gets the time notice, not an orphan', () => {
    const n = decideNotice(running(), { nowMs: min(61), delivered: {}, pidAlive: true });
    expect(n.marker).toBe('60m');
  });
});

describe('renderOrphan', () => {
  it('names the run, pid, and last known stages', () => {
    const text = renderOrphan({
      run_id: 'r1',
      pid: 4242,
      log_file: '/x.log',
      stages: { synthesize: { status: 'ok' }, merge: { status: 'blocked' } },
    });
    expect(text).toMatch(/orphaned run/);
    expect(text).toMatch(/pid: 4242/);
    expect(text).toMatch(/✗ merge: blocked/);
  });
});

describe('renderFailure', () => {
  it('includes rc breakdown, recovery note, and a stage summary', () => {
    const text = renderFailure({
      run_id: 'r1',
      repo_run_id: 'repo1',
      report_date: '2026-06-05',
      rc: { final: 1, run: 1, validate: 0, remote: 0, dispatch: 0 },
      recovery: { retried: ['curate.market'] },
      log_file: '/var/log/x.log',
      stages: { 'curate.market': { status: 'failed', error: 'boom' }, collect: { status: 'ok' } },
    });
    expect(text).toMatch(/final_rc: 1 \(run=1, validate=0, remote=0, dispatch=0\)/);
    expect(text).toMatch(/auto-recovered: curate\.market/);
    expect(text).toMatch(/✗ curate\.market: failed — boom/);
    expect(text).toMatch(/· collect: ok/);
  });
});
