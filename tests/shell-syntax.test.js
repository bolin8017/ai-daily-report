// Parse-checks every tracked shell script with `bash -n`.
//
// Pins the 2026-08-08 production outage: a plain apostrophe added to a log
// string inside merge-report.sh's `node -e '...'` body closed the shell's
// single quote early, so bash parsed the remaining JS as shell and Stage 4
// died on a syntax error. Biome only covers JS/JSON and the CI build never
// executes these scripts, so the break shipped through two PR reviews and
// only surfaced the next morning — after collect, curate and synthesize had
// already spent their full LLM cost.
//
// `bash -n` catches that class (unbalanced quotes, heredocs, if/fi) in
// milliseconds without running anything.

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const scripts = execFileSync('git', ['ls-files', '*.sh'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

describe('shell scripts parse', () => {
  it('finds shell scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('%s is syntactically valid', (script) => {
    const res = spawnSync('bash', ['-n', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(res.stderr.trim()).toBe('');
    expect(res.status).toBe(0);
  });
});
