// High-level production runner for ai-daily-report.
//
// Division of labour (see docs plan 2026-06-04): the bash launcher (Hermes
// cron wrapper) owns flock + the detached subshell that survives cron's pipe
// timeout + git branch sync; THIS script runs synchronously inside it and owns
// pipeline semantics — drive the sequencer (with auto-recovery), run the publish
// tail (validate → verify remote → dispatch Pages), and write structured state.
// Recovery itself lives in the sequencer (src/pipeline/run.js --auto-recover);
// here we only run, observe, and report.
//
// Commands:
//   node src/ops/production-run.js run     --state-dir D [--wiki-root W] [--skip-push]
//   node src/ops/production-run.js status  --state-dir D [--json]
//   node src/ops/production-run.js monitor --state-dir D
//
// Secrets: GITHUB_TOKEN is read from the environment for the Pages dispatch and
// is NEVER written to the run log or status JSON.

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStageResults, summarizeStages } from './stage-results.js';

const STATE_SCHEMA_VERSION = 1;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_SLUG = 'bolin8017/ai-daily-report';

// ---- pure: monitor notice decision (unit-tested) --------------------------

/**
 * Decide what the monitor should print given the latest run state, the clock,
 * and which notices were already delivered. Returns `{marker, text}` to print +
 * record, or null to stay silent. Production success is silent by policy.
 *
 * @param {object|null} latest  parsed latest.json
 * @param {object} ctx
 * @param {number} ctx.nowMs
 * @param {{['30m']?:boolean,['60m']?:boolean,failed?:boolean}} [ctx.delivered]
 * @returns {{marker: string, text: string}|null}
 */
export function decideNotice(latest, { nowMs, delivered = {}, pidAlive = true }) {
  if (!latest || typeof latest !== 'object') return null;
  if (latest.status === 'succeeded') return null; // success is silent
  if (latest.status === 'failed') {
    return delivered.failed ? null : { marker: 'failed', text: renderFailure(latest) };
  }
  if (latest.status === 'running') {
    // The runner died without writing a final state — report the orphan once.
    // Takes priority over the long-running notices: a dead process isn't "still
    // running", and final-state would have flipped status away from 'running'.
    if (!pidAlive) {
      return delivered.orphan ? null : { marker: 'orphan', text: renderOrphan(latest) };
    }
    const startMs = Date.parse(latest.started_at ?? '');
    if (!Number.isFinite(startMs)) return null;
    const elapsedMin = Math.floor((nowMs - startMs) / 60000);
    if (elapsedMin >= 60 && !delivered['60m']) {
      return { marker: '60m', text: renderRunning(latest, elapsedMin) };
    }
    if (elapsedMin >= 30 && !delivered['30m']) {
      return { marker: '30m', text: renderRunning(latest, elapsedMin) };
    }
  }
  return null;
}

function renderStages(stages) {
  if (!stages || typeof stages !== 'object') return '';
  const bad = new Set(['failed', 'blocked']);
  const warn = new Set(['degraded', 'suspicious-empty']);
  return Object.entries(stages)
    .map(([id, s]) => {
      const mark = bad.has(s.status) ? '✗' : warn.has(s.status) ? '!' : '·';
      return `${mark} ${id}: ${s.status}${s.error ? ` — ${s.error}` : ''}`;
    })
    .join('\n');
}

export function renderFailure(latest) {
  const rc = latest.rc ?? {};
  return [
    '[ai-daily-report production] FAILED',
    `run_id: ${latest.run_id ?? '?'}`,
    `repo_run_id: ${latest.repo_run_id ?? '?'}`,
    `report_date: ${latest.report_date ?? '?'}`,
    `final_rc: ${rc.final ?? '?'} (run=${rc.run ?? '?'}, validate=${rc.validate ?? '?'}, remote=${rc.remote ?? '?'}, dispatch=${rc.dispatch ?? '?'})`,
    latest.recovery?.retried?.length
      ? `auto-recovered: ${latest.recovery.retried.join(', ')}`
      : null,
    `log: ${latest.log_file ?? '?'}`,
    '--- stage summary ---',
    renderStages(latest.stages),
  ]
    .filter((l) => l != null)
    .join('\n');
}

export function renderRunning(latest, elapsedMin) {
  return [
    `[ai-daily-report production] still running after ${elapsedMin} minutes`,
    `run_id: ${latest.run_id ?? '?'}`,
    `log: ${latest.log_file ?? '?'}`,
    '--- latest stage status ---',
    renderStages(latest.stages),
  ].join('\n');
}

export function renderOrphan(latest) {
  return [
    '[ai-daily-report production] orphaned run — process ended without writing a final state',
    `run_id: ${latest.run_id ?? '?'}`,
    `pid: ${latest.pid ?? '?'}`,
    `log: ${latest.log_file ?? '?'}`,
    '--- last known stage status ---',
    renderStages(latest.stages),
  ].join('\n');
}

// ---- IO helpers -----------------------------------------------------------

function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Is a pid still alive? Signal 0 probes without delivering a signal. ESRCH =
// gone (orphan); EPERM = exists but owned by another user (alive). An unknown
// pid is treated as alive so we never falsely declare an orphan.
function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function isoNow() {
  return new Date().toISOString();
}

// Run a command, returning its exit code. stdout/stderr go to the open log fd so
// the sequencer's JSON lines land in the run log for later parsing.
function runToLog(cmd, args, logFd, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ...extraEnv },
  });
  return res.status ?? 1;
}

// Verify origin/data carries today's report. Returns true/false; never throws.
function remoteReportPresent(date, logFd) {
  runToLog('git', ['fetch', 'origin', 'data', '--quiet'], logFd);
  const res = spawnSync('git', ['ls-tree', '--name-only', '-r', 'origin/data'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const want = `data/reports/${date}.json`;
  return (res.stdout ?? '').split('\n').some((l) => l.trim() === want);
}

// POST a repository_dispatch to trigger the Pages build. The token is passed via
// an Authorization header arg; spawnSync does not echo argv to the log.
function dispatchPages(token, logFd) {
  if (!token) {
    writeToFd(logFd, '[production] ERROR: GITHUB_TOKEN missing; cannot dispatch Pages deploy\n');
    return 1;
  }
  const res = spawnSync(
    'curl',
    [
      '-fsS',
      '-X',
      'POST',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      `https://api.github.com/repos/${REPO_SLUG}/dispatches`,
      '-d',
      '{"event_type":"data-committed"}',
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', logFd] },
  );
  return res.status ?? 1;
}

function writeToFd(fd, text) {
  try {
    writeFileSync(fd, text);
  } catch {
    // best-effort logging
  }
}

// ---- commands -------------------------------------------------------------

function cmdRun({ stateDir, wikiRoot, skipPush }) {
  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const tz = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const logsDir = path.join(stateDir, 'logs');
  const runsDir = path.join(stateDir, 'runs');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  const logFile = path.join(logsDir, `${runId}.log`);
  const logFd = openSync(logFile, 'a');

  const startedAt = isoNow();
  const startMs = Date.now();
  const extraEnv = { REPORT_TIMEZONE: tz };
  if (wikiRoot) extraEnv.AI_DAILY_REPORT_WIKI_ROOT = wikiRoot;

  // Mark running before the long step so monitor can report a stuck run.
  const base = {
    schema_version: STATE_SCHEMA_VERSION,
    run_id: runId,
    repo_run_id: null,
    status: 'running',
    report_date: date,
    started_at: startedAt,
    ended_at: null,
    duration_ms: null,
    pid: process.pid,
    log_file: logFile,
    skip_push: Boolean(skipPush),
    stages: {},
    recovery: { retried: [] },
    publish: { attempted: false, report_present_remote: null, dispatch_rc: null },
    rc: { run: null, validate: null, remote: null, dispatch: null, final: null },
  };
  atomicWriteJson(path.join(stateDir, 'latest.json'), base);

  writeToFd(logFd, `[production:${runId}] start ${startedAt} (skip_push=${Boolean(skipPush)})\n`);
  const runRc = runToLog(
    'bash',
    ['scripts/run.sh', skipPush ? '--skip-push' : '--full'],
    logFd,
    extraEnv,
  );
  writeToFd(logFd, `[production:${runId}] run.sh rc=${runRc}\n`);

  // Parse what the sequencer emitted for observability.
  const summary = summarizeStages(parseStageResults(readFileSync(logFile, 'utf8')));
  base.stages = summary.byStage;
  base.recovery.retried = summary.retried;
  base.repo_run_id = summary.runId;
  base.rc.run = runRc;

  let validateRc = null;
  let remoteRc = null;
  let dispatchRc = null;
  if (runRc === 0 && !skipPush) {
    base.publish.attempted = true;
    validateRc = runToLog('npm', ['run', 'validate:report'], logFd);
    base.rc.validate = validateRc;

    const present = remoteReportPresent(date, logFd);
    base.publish.report_present_remote = present;
    remoteRc = present ? 0 : 1;
    base.rc.remote = remoteRc;
    if (!present) {
      writeToFd(
        logFd,
        `[production:${runId}] ERROR: origin/data missing data/reports/${date}.json\n`,
      );
    }

    dispatchRc = dispatchPages(process.env.GITHUB_TOKEN, logFd);
    base.publish.dispatch_rc = dispatchRc;
    base.rc.dispatch = dispatchRc;
  } else if (runRc === 0 && skipPush) {
    // rehearsal: validate the local report only, no publish
    validateRc = runToLog('npm', ['run', 'validate:report'], logFd);
    base.rc.validate = validateRc;
  }

  const finalRc =
    runRc !== 0
      ? runRc
      : validateRc
        ? validateRc
        : remoteRc
          ? remoteRc
          : dispatchRc
            ? dispatchRc
            : 0;
  base.rc.final = finalRc;
  base.status = finalRc === 0 ? 'succeeded' : 'failed';
  base.ended_at = isoNow();
  base.duration_ms = Date.now() - startMs;

  closeSync(logFd);
  atomicWriteJson(path.join(runsDir, `${runId}.json`), base);
  atomicWriteJson(path.join(stateDir, 'latest.json'), base);
  return finalRc;
}

function cmdStatus({ stateDir, json }) {
  const latest = readJson(path.join(stateDir, 'latest.json'));
  if (!latest) {
    process.stderr.write('[production] no latest.json found\n');
    return 1;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(latest, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${latest.status} run_id=${latest.run_id} date=${latest.report_date} final_rc=${latest.rc?.final}\n`,
    );
  }
  return 0;
}

function cmdMonitor({ stateDir }) {
  const latest = readJson(path.join(stateDir, 'latest.json'));
  if (!latest) return 0; // nothing to report
  const noticesDir = path.join(stateDir, 'notices');
  const markerFor = (m) => path.join(noticesDir, `${latest.run_id}-${m}`);
  const delivered = {
    '30m': existsSync(markerFor('30m')),
    '60m': existsSync(markerFor('60m')),
    failed: existsSync(markerFor('failed')),
    orphan: existsSync(markerFor('orphan')),
  };
  const notice = decideNotice(latest, {
    nowMs: Date.now(),
    delivered,
    pidAlive: isProcessAlive(latest.pid),
  });
  if (!notice) return 0;
  mkdirSync(noticesDir, { recursive: true });
  writeFileSync(markerFor(notice.marker), '');
  process.stdout.write(`${notice.text}\n`);
  return 0;
}

// ---- CLI ------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--state-dir') opts.stateDir = rest[++i];
    else if (a === '--wiki-root') opts.wikiRoot = rest[++i];
    else if (a === '--skip-push') opts.skipPush = true;
    else if (a === '--json') opts.json = true;
    else {
      process.stderr.write(`[production] unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

const isMain = (() => {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.stateDir) {
    process.stderr.write('[production] --state-dir is required\n');
    process.exit(2);
  }
  let rc = 0;
  if (opts.command === 'run') rc = cmdRun(opts);
  else if (opts.command === 'status') rc = cmdStatus(opts);
  else if (opts.command === 'monitor') rc = cmdMonitor(opts);
  else {
    process.stderr.write(
      `[production] unknown command: ${opts.command ?? '(none)'} (run|status|monitor)\n`,
    );
    rc = 2;
  }
  process.exit(rc);
}
