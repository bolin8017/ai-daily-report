// Git commit + push for the daily report pipeline.
//
// Bot-produced artifacts (reports, memory, feeds snapshot, staging)
// live on the `data` orphan branch so `main` stays a record of
// human-authored code changes. Commits are built with git plumbing
// (read-tree into an isolated GIT_INDEX_FILE, write-tree, commit-tree)
// so main's working tree and index are never touched.
//
// Dual mode:
//   - importable: `import { commitAndPush } from './lib/commit.js'`
//   - CLI:        `node src/lib/commit.js <date> <message> <path>...`
//
// Auth: if `GITHUB_TOKEN` is set, injects it as a per-invocation
// `http.extraheader` via `GIT_CONFIG_COUNT` env (Git 2.31+). Token
// never touches `.git/config` or the remote URL, so a mid-pipeline
// crash cannot leave the token persisted in the Docker volume. This
// mirrors the mechanism used by GitHub's own actions/checkout.
// If `GITHUB_TOKEN` is unset, falls back to the host's credential
// helper or SSH keys.
//
// Bootstrap: if `origin/data` doesn't exist (new deployment, disaster
// recovery), builds an orphan commit (no parent) instead of failing.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA_BRANCH = 'data';

/**
 * Returns env vars that inject an `http.extraheader` bearing the GitHub
 * token into git operations, without writing anything to `.git/config`
 * or modifying argv. Uses Git 2.31+'s `GIT_CONFIG_COUNT` mechanism.
 * Returns an empty object if no token is configured (local dev falls
 * back to credential helper / ssh).
 */
function gitAuthEnv() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

function git(args, { reject = true, env, cwd } = {}) {
  return new Promise((resolve, rejectPromise) => {
    const proc = spawn('git', args, {
      env: { ...process.env, ...(env ?? {}) },
      cwd,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += c.toString('utf8');
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    proc.on('error', rejectPromise);
    proc.on('close', (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && reject) {
        rejectPromise(
          new Error(
            sanitizeToken(`[commit] git ${args.join(' ')} exited ${code}: ${stderr.trim()}`),
          ),
        );
      } else {
        resolve(result);
      }
    });
  });
}

async function ensureGitAuthor() {
  const name = await git(['config', 'user.name'], { reject: false });
  if (name.code !== 0 || !name.stdout) {
    await git(['config', 'user.name', 'AI Daily Report']);
  }
  const email = await git(['config', 'user.email'], { reject: false });
  if (email.code !== 0 || !email.stdout) {
    await git(['config', 'user.email', 'noreply@ai-daily-report.local']);
  }
}

// Defense-in-depth: even though the token is no longer embedded in any
// argv or remote URL, redact it from captured stderr before it is raised
// or logged. Cheap insurance for the case where some future change
// accidentally echoes the token in a diagnostic.
function sanitizeToken(str) {
  if (!process.env.GITHUB_TOKEN) return str;
  return str.replaceAll(process.env.GITHUB_TOKEN, '***');
}

/**
 * Commit data changes to the `data` branch and push, without touching
 * the caller's working tree or index. Uses git plumbing end-to-end.
 *
 * On push the commit is protected by `--force-with-lease` pinned to
 * the parent we read-tree'd from, so a concurrent push to `data`
 * causes this one to abort rather than clobber.
 *
 * @param {object} opts
 * @param {string} opts.date - YYYY-MM-DD (for logging only)
 * @param {string} [opts.message] - commit message (default: "report: {date} daily creative brief")
 * @param {string[]} [opts.paths] - paths to include (default: reports + memory + snapshot)
 * @returns {Promise<{ pushed: boolean, sha: string | null }>}
 */
export async function commitAndPush({ date, message, paths }) {
  await ensureGitAuthor();

  const addPaths = paths ?? ['data/reports', 'data/memory.json', 'data/feeds-snapshot.json'];
  const commitMsg = message ?? `report: ${date} daily creative brief`;
  const explicitPaths = Array.isArray(paths);
  const authEnv = gitAuthEnv();

  // Fetch the data branch. Missing-on-remote is legitimate (first-run
  // bootstrap); anything else is a real error we should surface.
  const fetchResult = await git(
    ['fetch', 'origin', `${DATA_BRANCH}:refs/remotes/origin/${DATA_BRANCH}`],
    { reject: false, env: authEnv },
  );
  const isBootstrap = fetchResult.code !== 0;
  if (isBootstrap && !/couldn't find remote ref/i.test(fetchResult.stderr)) {
    throw new Error(sanitizeToken(`[commit] fetch failed: ${fetchResult.stderr}`));
  }
  if (isBootstrap) {
    console.error(`[commit] origin/${DATA_BRANCH} missing — creating orphan commit`);
  }

  // Build the commit in an isolated index so we never touch the
  // caller's working tree or index. mkdtempSync gives a unique dir
  // per invocation so concurrent / crashed prior runs don't collide.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-daily-report-'));
  const tmpIndex = path.join(tmpDir, 'index');
  const indexEnv = { GIT_INDEX_FILE: tmpIndex };

  try {
    if (!isBootstrap) {
      await git(['read-tree', `refs/remotes/origin/${DATA_BRANCH}`], { env: indexEnv });
    }

    // Stage paths. -f bypasses main's .gitignore which excludes data/.
    // If the caller passed explicit paths (analyze.sh for a specific
    // report file) a missing file is a real bug, not a benign skip.
    for (const p of addPaths) {
      if (!fs.existsSync(p)) {
        if (explicitPaths) {
          throw new Error(`[commit] explicit path missing on disk: ${p}`);
        }
        console.error(`[commit] default path missing (skipping): ${p}`);
        continue;
      }
      await git(['add', '--force', '--', p], { env: indexEnv });
    }

    const newTree = (await git(['write-tree'], { env: indexEnv })).stdout;

    // Skip the push if the tree matches the parent — no net change.
    // (Only meaningful when we have a parent; bootstrap always pushes.)
    let parent = null;
    if (!isBootstrap) {
      const parentTree = (await git(['rev-parse', `refs/remotes/origin/${DATA_BRANCH}^{tree}`]))
        .stdout;
      if (newTree === parentTree) {
        console.error('[commit] no changes to commit — skipping push');
        return { pushed: false, sha: null };
      }
      parent = (await git(['rev-parse', `refs/remotes/origin/${DATA_BRANCH}`])).stdout;
    }

    const commitArgs = parent
      ? ['commit-tree', newTree, '-p', parent, '-m', commitMsg]
      : ['commit-tree', newTree, '-m', commitMsg];
    const commit = (await git(commitArgs)).stdout;

    // Push. With --force-with-lease tied to our known parent the push
    // aborts if the remote ref moved between fetch and push, so we
    // never silently clobber a concurrent update.
    const pushArgs = ['push', 'origin'];
    if (parent) {
      pushArgs.push(`--force-with-lease=refs/heads/${DATA_BRANCH}:${parent}`);
    }
    pushArgs.push(`${commit}:refs/heads/${DATA_BRANCH}`);
    await git(pushArgs, { env: authEnv });

    const shortSha = commit.slice(0, 7);
    console.error(`[commit] pushed ${shortSha} to origin/${DATA_BRANCH}`);
    return { pushed: true, sha: shortSha };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[commit] tmp index cleanup warning: ${e.message}`);
    }
  }
}

// CLI: `node src/lib/commit.js <date> <message> <path> [path ...]`
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [date, message, ...paths] = process.argv.slice(2);
  if (!date || !message || paths.length === 0) {
    console.error('usage: commit.js <date> <message> <path> [path ...]');
    process.exit(2);
  }
  commitAndPush({ date, message, paths }).catch((err) => {
    console.error(`[commit] FATAL: ${err.message ?? err}`);
    process.exit(1);
  });
}

// Exported for tests
export const _internals = { git, ensureGitAuthor, gitAuthEnv };
