// Integration tests for commitAndPush against a temp bare-repo "origin".
//
// Catches the regressions that mocking spawn() can't:
//   - GIT_INDEX_FILE isolation (caller's index/working tree untouched)
//   - empty-tree shortcut (no-op call returns pushed:false)
//   - explicit-path-missing fails loud
//   - bootstrap path (origin/data missing → orphan commit)
//
// No network: origin is a local bare repo at $TMPDIR/<rand>/origin.git.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAndPush } from '../src/lib/commit.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

let tmpRoot;
let bareRepo;
let workingRepo;
let prevCwd;

function setupRepoWithDataBranch() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-it-'));
  bareRepo = path.join(tmpRoot, 'origin.git');
  workingRepo = path.join(tmpRoot, 'work');

  git(['init', '--bare', '--initial-branch=main', bareRepo]);
  git(['clone', bareRepo, workingRepo]);
  git(['config', 'user.name', 'Test'], workingRepo);
  git(['config', 'user.email', 'test@example.com'], workingRepo);

  // Seed main with one commit so HEAD exists
  fs.writeFileSync(path.join(workingRepo, 'README.md'), '# test\n');
  git(['add', 'README.md'], workingRepo);
  git(['commit', '-m', 'initial'], workingRepo);
  git(['push', 'origin', 'main'], workingRepo);

  // Seed the data orphan branch via a throwaway second clone, so we
  // never disturb workingRepo's checkout (avoids "checkout main would
  // overwrite README.md" when the orphan dance leaves it untracked).
  const seedClone = path.join(tmpRoot, 'seed');
  git(['clone', bareRepo, seedClone]);
  git(['config', 'user.name', 'Test'], seedClone);
  git(['config', 'user.email', 'test@example.com'], seedClone);
  git(['checkout', '--orphan', 'data'], seedClone);
  git(['rm', '-rf', '.'], seedClone);
  fs.mkdirSync(path.join(seedClone, 'data', 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(seedClone, 'data', 'reports', '2026-01-01.json'),
    '{"date":"2026-01-01"}\n',
  );
  git(['add', 'data'], seedClone);
  git(['commit', '-m', 'seed data'], seedClone);
  git(['push', '-u', 'origin', 'data'], seedClone);
  fs.rmSync(seedClone, { recursive: true, force: true });
}

describe('commitAndPush — plumbing path against temp bare repo', () => {
  beforeEach(() => {
    // commit.js reads GITHUB_TOKEN to rewrite origin URL — but our origin
    // is a local bare repo, not GitHub, so unset it for these tests.
    vi.stubEnv('GITHUB_TOKEN', '');
    setupRepoWithDataBranch();
    prevCwd = process.cwd();
    process.chdir(workingRepo);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('pushes new file to data branch and leaves main untouched', async () => {
    const indexBefore = git(['ls-files', '--stage'], workingRepo);
    const headBefore = git(['rev-parse', 'HEAD'], workingRepo);
    const tmpFilesBefore = fs
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith('ai-daily-report-'));

    fs.mkdirSync(path.join(workingRepo, 'data', 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(workingRepo, 'data', 'reports', '2026-04-14.json'),
      '{"date":"2026-04-14"}\n',
    );

    const result = await commitAndPush({
      date: '2026-04-14',
      message: 'test: report 2026-04-14',
      paths: ['data/reports/2026-04-14.json'],
    });

    expect(result.pushed).toBe(true);
    expect(result.sha).toMatch(/^[a-f0-9]{7}$/);

    // Caller's main remains exactly where it was — no commit on main, no
    // changes to main's index, no checkout to data branch happened.
    expect(git(['rev-parse', 'HEAD'], workingRepo)).toBe(headBefore);
    expect(git(['ls-files', '--stage'], workingRepo)).toBe(indexBefore);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], workingRepo)).toBe('main');

    // Data branch advanced and contains both seed file and new file
    git(['fetch', 'origin', 'data'], workingRepo);
    const tree = git(['ls-tree', '-r', 'origin/data'], workingRepo);
    expect(tree).toContain('data/reports/2026-01-01.json');
    expect(tree).toContain('data/reports/2026-04-14.json');

    // Tmp index dir was cleaned up
    const tmpFilesAfter = fs
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith('ai-daily-report-'));
    expect(tmpFilesAfter).toEqual(tmpFilesBefore);
  });

  it('returns pushed:false when called twice with the same content', async () => {
    fs.mkdirSync(path.join(workingRepo, 'data', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(workingRepo, 'data', 'reports', '2026-04-14.json'), '{"x":1}\n');

    const first = await commitAndPush({
      date: '2026-04-14',
      message: 'first',
      paths: ['data/reports/2026-04-14.json'],
    });
    expect(first.pushed).toBe(true);

    git(['fetch', 'origin', 'data'], workingRepo);
    const tipAfterFirst = git(['rev-parse', 'origin/data'], workingRepo);

    // Same file content, no real change — should be no-op
    const second = await commitAndPush({
      date: '2026-04-14',
      message: 'second',
      paths: ['data/reports/2026-04-14.json'],
    });
    expect(second.pushed).toBe(false);
    expect(second.sha).toBe(null);

    git(['fetch', 'origin', 'data'], workingRepo);
    expect(git(['rev-parse', 'origin/data'], workingRepo)).toBe(tipAfterFirst);
  });

  it('throws when an explicit path is missing on disk', async () => {
    await expect(
      commitAndPush({
        date: '2026-04-14',
        message: 'should-fail',
        paths: ['data/reports/does-not-exist.json'],
      }),
    ).rejects.toThrow(/explicit path missing/);
  });

  it('bootstraps an orphan commit when origin/data does not exist', async () => {
    // Tear down the seeded data branch so we hit the bootstrap path.
    // (No local `data` branch exists in workingRepo — only the remote-
    // tracking ref — because seeding happened in a throwaway clone.)
    git(['push', 'origin', '--delete', 'data'], workingRepo);
    git(['update-ref', '-d', 'refs/remotes/origin/data'], workingRepo);

    fs.mkdirSync(path.join(workingRepo, 'data', 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(workingRepo, 'data', 'reports', '2026-04-14.json'),
      '{"date":"2026-04-14"}\n',
    );

    const result = await commitAndPush({
      date: '2026-04-14',
      message: 'bootstrap report',
      paths: ['data/reports/2026-04-14.json'],
    });
    expect(result.pushed).toBe(true);

    git(['fetch', 'origin', 'data'], workingRepo);
    // Orphan: no parent
    const parents = git(['rev-list', '--parents', '-n', '1', 'origin/data'], workingRepo).split(
      ' ',
    );
    expect(parents).toHaveLength(1);
    // And contains the file
    expect(git(['ls-tree', '-r', 'origin/data'], workingRepo)).toContain(
      'data/reports/2026-04-14.json',
    );
  });
});
