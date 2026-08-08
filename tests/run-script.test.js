// Shell-level tests for scripts/run.sh — the flag → mode → publish decision.
//
// `node` and the stage scripts are stubbed via PATH and a sandbox scripts/ dir,
// so the dispatch is exercised without running a stage. Each stub appends its
// argv and the SKIP_PUSH it saw to a log, which is what the assertions read.
//
// The publish decision is the part worth pinning. run.sh defaults to
// SKIP_PUSH=1 and each flag reopens it differently: --full unsets it,
// --skip-push forces it, --analyze leaves the default in place, and
// --recover-from honors a caller-supplied SKIP_PUSH=1 rehearsal via
// ORIG_SKIP_PUSH while publishing otherwise. Getting that wrong either strands
// a finished report unpublished or publishes one the operator meant to inspect
// first — and --recover-from is the path a missed day is recovered through.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
// run.sh derives the report filename the same way; commit_outputs only has
// something to commit if that file exists.
const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

// Records "node <args…> SKIP_PUSH=<value-or-unset>" per invocation.
// STUB_FAIL is matched against the argv so a single stage can be failed on its
// own, rather than every invocation at once.
const STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $* SKIP_PUSH=\${SKIP_PUSH:-unset}" >> "$RUN_LOG"
case "$*" in
  *"\${STUB_FAIL:-__never__}"*) exit 1 ;;
esac
exit 0
`;

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-sh-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'data', 'reports'), { recursive: true });

  fs.symlinkSync(path.join(REPO_ROOT, 'scripts', 'run.sh'), path.join(root, 'scripts', 'run.sh'));
  // Stage scripts run.sh shells out to directly — stubbed, not symlinked.
  for (const s of ['curate.sh', 'context.sh', 'synthesize.sh']) {
    fs.writeFileSync(path.join(root, 'scripts', s), STUB, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(root, 'bin', 'node'), STUB, { mode: 0o755 });

  // Stage outputs commit_outputs looks for. Without at least one it refuses to
  // commit and returns 1, which is its own test below.
  fs.writeFileSync(path.join(root, 'data', 'reports', `${DATE}.json`), '{}');
  fs.writeFileSync(path.join(root, 'data', 'feeds-snapshot.json'), '{}');

  return { root, log: path.join(root, 'run.log') };
}

function runRun(args, env = {}) {
  const r = spawnSync('bash', [path.join(sb.root, 'scripts', 'run.sh'), ...args], {
    cwd: sb.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      RUN_LOG: sb.log,
      ...env,
    },
  });
  const log = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').trim().split('\n') : [];
  return { ...r, log };
}

// The commit step is the publish: run.sh only reaches `node src/lib/commit.js`
// when it means to push, and gates it on SKIP_PUSH internally.
function commitLine(log) {
  return log.find((l) => l.includes('src/lib/commit.js'));
}

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('run.sh mode dispatch', () => {
  it('runs collect only, no push, with no flags', () => {
    const r = runRun([]);
    expect(r.status).toBe(0);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/src\/collect\.js --skip-push/);
  });

  it('runs collect + sequencer + commit on --full', () => {
    const r = runRun(['--full']);
    expect(r.status).toBe(0);
    expect(r.log[0]).toMatch(/src\/collect\.js/);
    expect(r.log[1]).toMatch(/src\/pipeline\/run\.js --resume --auto-recover/);
    expect(commitLine(r.log)).toBeDefined();
  });

  it('resumes the sequencer without committing on --analyze', () => {
    const r = runRun(['--analyze']);
    expect(r.status).toBe(0);
    expect(r.log[0]).toMatch(/src\/pipeline\/run\.js --resume SKIP_PUSH=1/);
    expect(commitLine(r.log)).toBeUndefined();
  });

  it('runs the named stage plus downstream on --recover-from', () => {
    const r = runRun(['--recover-from', 'merge']);
    expect(r.status).toBe(0);
    expect(r.log[0]).toMatch(/src\/pipeline\/run\.js --from merge/);
    expect(commitLine(r.log)).toBeDefined();
  });

  it('rejects --recover-from with no stage', () => {
    const r = runRun(['--recover-from']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/requires a <stage>/);
  });

  it('rejects an unknown flag with usage', () => {
    const r = runRun(['--nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown flag: --nope/);
    expect(r.stderr).toMatch(/usage: run\.sh/);
  });
});

describe('run.sh publish decision', () => {
  it('publishes on --full', () => {
    expect(commitLine(runRun(['--full']).log)).toMatch(/SKIP_PUSH=unset/);
  });

  it('does not publish on --skip-push', () => {
    const r = runRun(['--skip-push']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SKIP_PUSH — skipping commit and push/);
    expect(commitLine(r.log)).toBeUndefined();
  });

  it('publishes on --recover-from by default', () => {
    expect(commitLine(runRun(['--recover-from', 'merge']).log)).toMatch(/SKIP_PUSH=unset/);
  });

  // ORIG_SKIP_PUSH exists for exactly this: a deliberate no-push rehearsal of a
  // recovery must not publish just because --recover-from normally does.
  it('honors a caller-supplied SKIP_PUSH=1 rehearsal of --recover-from', () => {
    const r = runRun(['--recover-from', 'merge'], { SKIP_PUSH: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SKIP_PUSH — skipping commit and push/);
    expect(commitLine(r.log)).toBeUndefined();
  });

  // set -e plus the sequencer running before commit_outputs is what keeps a
  // failed run from publishing a half-built report.
  it('does not publish when the sequencer fails', () => {
    const r = runRun(['--full'], { STUB_FAIL: 'pipeline/run.js' });
    expect(r.status).not.toBe(0);
    expect(r.log.some((l) => l.includes('pipeline/run.js'))).toBe(true);
    expect(commitLine(r.log)).toBeUndefined();
  });

  // Publishing nothing is a failure, not a quiet success: an empty commit set
  // means the stages did not produce what the run claims to have produced.
  it('fails rather than publishing nothing when no outputs exist', () => {
    fs.rmSync(path.join(sb.root, 'data', 'reports', `${DATE}.json`));
    fs.rmSync(path.join(sb.root, 'data', 'feeds-snapshot.json'));
    const r = runRun(['--full']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no outputs to commit/);
    expect(commitLine(r.log)).toBeUndefined();
  });
});
