import { describe, expect, it, vi } from 'vitest';
import {
  buildRunArgs,
  decideNotice,
  dispatchPages,
  parseArgs,
  renderFailure,
  renderOrphan,
  renderSuccess,
} from '../src/ops/production-run.js';

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
  it('prints a success notice once, then suppresses it', () => {
    const succeeded = {
      status: 'succeeded',
      run_id: 'r',
      repo_run_id: 'repo1',
      report_date: '2026-06-05',
      started_at: START,
      duration_ms: 1_500_000,
    };
    const first = decideNotice(succeeded, { nowMs: min(90), delivered: {} });
    expect(first).toEqual({
      marker: 'success',
      text: expect.stringContaining('completed successfully'),
    });
    expect(first.text).toMatch(/report: https:\/\/bolin8017\.github\.io\/ai-daily-report\//);
    expect(decideNotice(succeeded, { nowMs: min(90), delivered: { success: true } })).toBeNull();
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

  it('shows the single retry was spent when it was attempted but failed (529 shape)', () => {
    const text = renderFailure({
      run_id: 'r1',
      report_date: '2026-06-22',
      rc: { final: 1, run: 1 },
      recovery: { attempted: ['synthesize'], retried: [] },
      log_file: '/var/log/x.log',
      stages: { synthesize: { status: 'failed' }, merge: { status: 'blocked' } },
    });
    expect(text).toMatch(/retry attempted \(failed\): synthesize/);
    expect(text).not.toMatch(/auto-recovered:/);
  });

  it('flags a dispatch-only failure as published-but-undeployed (07-20 shape)', () => {
    const text = renderFailure({
      run_id: 'r1',
      report_date: '2026-07-20',
      rc: { final: 22, run: 0, validate: 0, remote: 0, dispatch: 22 },
      log_file: '/var/log/x.log',
      stages: {},
    });
    expect(text).toMatch(/report published .* Pages dispatch failed/);
    expect(text).toMatch(/gh workflow run deploy\.yml/);
  });

  it('does not show the undeployed hint when the pipeline itself failed', () => {
    const text = renderFailure({
      run_id: 'r1',
      report_date: '2026-06-30',
      rc: { final: 1, run: 1, dispatch: null },
      log_file: '/var/log/x.log',
      stages: {},
    });
    expect(text).not.toMatch(/published/);
  });
});

describe('dispatchPages retry', () => {
  const noLog = -1;

  it('retries on transient failure and succeeds (the 07-20 GitHub 503 case)', () => {
    const curlFn = vi.fn().mockReturnValueOnce(22).mockReturnValueOnce(22).mockReturnValueOnce(0);
    const sleepFn = vi.fn();
    const rc = dispatchPages('tok', noLog, { curlFn, sleepFn });
    expect(rc).toBe(0);
    expect(curlFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('returns the last rc after exhausting attempts', () => {
    const curlFn = vi.fn().mockReturnValue(22);
    const rc = dispatchPages('tok', noLog, { curlFn, sleepFn: vi.fn(), attempts: 3 });
    expect(rc).toBe(22);
    expect(curlFn).toHaveBeenCalledTimes(3);
  });

  it('does not sleep or retry after a first-attempt success', () => {
    const curlFn = vi.fn().mockReturnValue(0);
    const sleepFn = vi.fn();
    expect(dispatchPages('tok', noLog, { curlFn, sleepFn })).toBe(0);
    expect(curlFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('fails immediately without a token', () => {
    const curlFn = vi.fn();
    expect(dispatchPages(undefined, noLog, { curlFn })).toBe(1);
    expect(curlFn).not.toHaveBeenCalled();
  });
});

describe('renderSuccess', () => {
  it('includes date, run ids, duration, recovery note, and report URL', () => {
    const text = renderSuccess({
      run_id: 'r1',
      repo_run_id: 'repo1',
      report_date: '2026-06-05',
      duration_ms: 1_520_000,
      recovery: { retried: ['curate.market'] },
    });
    expect(text).toMatch(/completed successfully/);
    expect(text).toMatch(/report_date: 2026-06-05/);
    expect(text).toMatch(/run_id: r1/);
    expect(text).toMatch(/repo_run_id: repo1/);
    expect(text).toMatch(/duration: 25 min/);
    expect(text).toMatch(/auto-recovered: curate\.market/);
    expect(text).toMatch(/report: https:\/\/bolin8017\.github\.io\/ai-daily-report\//);
  });

  it('surfaces missing report days when the gap check found holes', () => {
    const text = renderSuccess({
      run_id: 'r1',
      report_date: '2026-07-07',
      publish: { missing_days: ['2026-07-02', '2026-07-03'] },
    });
    expect(text).toMatch(/missing reports \(last \d+ days\): 2026-07-02, 2026-07-03/);
  });

  it('surfaces an empty re-roll so the trend stays visible (dr-6)', () => {
    const text = renderSuccess({
      run_id: 'r1',
      report_date: '2026-07-22',
      recovery: { rerolled: ['curate.market'] },
    });
    expect(text).toMatch(/empty re-rolled: curate\.market/);
  });

  it('omits the missing-days line when there are no gaps', () => {
    const text = renderSuccess({
      run_id: 'r1',
      report_date: '2026-07-07',
      publish: { missing_days: [] },
    });
    expect(text).not.toMatch(/missing reports/);
  });
});

describe('buildRunArgs', () => {
  it('defaults to a full run (re-collect + sequencer) that publishes', () => {
    expect(buildRunArgs()).toEqual({ args: ['scripts/run.sh', '--full'], env: {} });
  });

  it('uses --skip-push for a full-run rehearsal', () => {
    expect(buildRunArgs({ skipPush: true })).toEqual({
      args: ['scripts/run.sh', '--skip-push'],
      env: {},
    });
  });

  it('resumes from a stage without re-running collect, still publishing', () => {
    // --recover-from drives the sequencer --from <stage>; it never touches Stage 1
    // collect, so metadata.json (the freshness anchor) keeps its mtime and the
    // already-finished upstream stages stay satisfied and get reused.
    expect(buildRunArgs({ recoverFrom: 'merge' })).toEqual({
      args: ['scripts/run.sh', '--recover-from', 'merge'],
      env: {},
    });
  });

  it('passes SKIP_PUSH via env for a recover-from rehearsal', () => {
    // run.sh --recover-from honours SKIP_PUSH from the environment (publish_unless_skip),
    // not a positional flag — so a no-push rehearsal must set it in env.
    expect(buildRunArgs({ recoverFrom: 'merge', skipPush: true })).toEqual({
      args: ['scripts/run.sh', '--recover-from', 'merge'],
      env: { SKIP_PUSH: '1' },
    });
  });
});

describe('parseArgs', () => {
  it('parses run with --recover-from <stage>', () => {
    expect(parseArgs(['run', '--state-dir', '/s', '--recover-from', 'merge'])).toMatchObject({
      command: 'run',
      stateDir: '/s',
      recoverFrom: 'merge',
    });
  });

  it('leaves recoverFrom undefined for a plain run', () => {
    expect(parseArgs(['run', '--state-dir', '/s']).recoverFrom).toBeUndefined();
  });
});
