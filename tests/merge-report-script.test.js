// Shell-level integration tests for scripts/merge-report.sh. The real script
// runs in a tmp sandbox that symlinks src/ and themes/ back to the repo, so the
// merge is real while data/reports/ and the seen-repos ledger stay throwaway.
// `dirname "$0"` does not resolve symlinks, so the script's own `cd ..` lands
// in the sandbox and every cwd-relative path it writes follows.
//
// Pins the 2026-08-08 outage: an apostrophe in a log string closed the shell
// quote wrapping the `node -e '...'` body, so Stage 4 died on a bash syntax
// error after collect/curate/synthesize had already spent a full run. The
// branch that carried the apostrophe (seen-repos ledger unreadable) had never
// executed in production, and merge-report.sh was the one pipeline script with
// no test that runs it — curate.sh, check-faithfulness.sh, archive-month.sh and
// hydrate-archive.sh all had one.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DATE = '2026-01-15';

// Minimal inputs that compose into a valid report — same shape as merge.test.js's
// fixtures. The discoveries pick is what gives appendSeen something to record.
const EDITORIAL = {
  schema_version: '2.1-editorial',
  date: DATE,
  theme: 'ai-builder',
  lead: { html: '<p>lead</p>' },
  signals: {
    focus: [
      {
        id: 'sig.focus.0',
        title: 's',
        body: 'b',
        audience: 'general',
        source_links: ['discoveries.rising.0:foo/bar'],
      },
    ],
    predictions: [],
  },
};

const CURATED = {
  discoveries: {
    rising: [
      { id: 'discoveries.rising.0:foo/bar', name: 'foo/bar', relevance: 'd', audience: 'general' },
    ],
    dev_watch: [],
  },
  pulse: { hn: [{ id: 'pulse.hn.0:hn-1', title: 't', audience: 'general' }] },
  market: { ma: [] },
  tech: { vendor: [] },
};

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-sh-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  // Resolved relative to cwd by the script and by merge.js's theme loader.
  for (const dir of ['src', 'themes']) {
    fs.symlinkSync(path.join(REPO_ROOT, dir), path.join(root, dir));
  }
  fs.symlinkSync(
    path.join(REPO_ROOT, 'scripts', 'merge-report.sh'),
    path.join(root, 'scripts', 'merge-report.sh'),
  );
  const staging = path.join(root, 'data', 'staging');
  fs.mkdirSync(path.join(staging, 'curated'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'editorial.json'), JSON.stringify(EDITORIAL));
  for (const [sec, body] of Object.entries(CURATED)) {
    fs.writeFileSync(path.join(staging, 'curated', `${sec}.json`), JSON.stringify(body));
  }
  return { root, staging, ledger: path.join(root, 'data', 'seen-repos.json') };
}

function runMerge(env = {}) {
  return spawnSync('bash', [path.join(sb.root, 'scripts', 'merge-report.sh'), DATE], {
    cwd: sb.root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function readReport() {
  return JSON.parse(fs.readFileSync(path.join(sb.root, 'data', 'reports', `${DATE}.json`), 'utf8'));
}

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('merge-report.sh', () => {
  it('composes a valid report and records the day picks in the ledger', () => {
    fs.writeFileSync(sb.ledger, '[]');
    const r = runMerge();
    expect(r.stderr).not.toMatch(/syntax error/);
    expect(r.status).toBe(0);

    const report = readReport();
    expect(report.schema_version).toBe(2.1);
    expect(report.date).toBe(DATE);
    expect(report.discoveries.rising).toHaveLength(1);

    expect(r.stdout).toMatch(/seen-repos \+1/);
    expect(JSON.parse(fs.readFileSync(sb.ledger, 'utf8'))).toEqual([
      { repo: 'foo/bar', first_shown: DATE, stars_at_show: 0 },
    ]);
  });

  // The branch that carried the apostrophe. #169 made appendSeen refuse to write
  // when the prior ledger cannot be read (an unreadable local file with no
  // readable data branch, e.g. a fresh host), and the report must still be
  // written — losing a day of dedup entries is the cheap side, losing the report
  // is not. The sandbox is not a git repo, so the data-branch read fails too.
  it('still writes the report when the seen-repos ledger is unreadable', () => {
    fs.writeFileSync(sb.ledger, 'not json');
    const r = runMerge();
    expect(r.stderr).not.toMatch(/syntax error/);
    expect(r.status).toBe(0);

    expect(readReport().discoveries.rising).toHaveLength(1);
    expect(r.stderr).toMatch(/seen-repos ledger NOT updated/);
    // Refused rather than reset: the unreadable file is left exactly as found.
    expect(fs.readFileSync(sb.ledger, 'utf8')).toBe('not json');
  });

  it('exits 1 when the editorial input is missing', () => {
    fs.rmSync(path.join(sb.staging, 'editorial.json'));
    const r = runMerge();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/editorial input missing/);
  });

  // The script's own contract (see its header): shell-derived values cross into
  // the JS body via process.env, never interpolated into the program text, so a
  // quote in one of them cannot break out of a JS string literal. The failure is
  // expected here — the theme does not exist — but it must be a clean failure,
  // not a bash parse error.
  it('survives a quote in a shell-derived value', () => {
    fs.writeFileSync(sb.ledger, '[]');
    const r = runMerge({ ACTIVE_THEME: "ai'builder" });
    expect(r.stderr).not.toMatch(/syntax error|unexpected token/);
    expect(r.status).not.toBe(0);
  });
});
