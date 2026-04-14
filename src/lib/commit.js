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
// Auth: if `GITHUB_TOKEN` is set, embeds it in the push URL via
// `x-access-token:TOKEN@github.com`. Otherwise relies on the host's
// configured credential helper or SSH keys.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REMOTE_URL = 'https://github.com/bolin8017/ai-daily-report.git';
const DATA_BRANCH = 'data';

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

function tokenizedRemoteUrl(token) {
  return REMOTE_URL.replace('https://', `https://x-access-token:${token}@`);
}

function sanitizeToken(str) {
  if (!process.env.GITHUB_TOKEN) return str;
  return str.replaceAll(process.env.GITHUB_TOKEN, '***');
}

/**
 * Commit data changes to the `data` branch and push, without touching
 * the caller's working tree or index. Uses git plumbing end-to-end.
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

  if (process.env.GITHUB_TOKEN) {
    await git(['remote', 'set-url', 'origin', tokenizedRemoteUrl(process.env.GITHUB_TOKEN)]);
  }

  try {
    // 1. Fetch the current data branch to a remote-tracking ref
    await git(['fetch', 'origin', `${DATA_BRANCH}:refs/remotes/origin/${DATA_BRANCH}`]);

    // 2. Build the new commit in an isolated index so we never touch
    //    the caller's index or working tree.
    const tmpIndex = path.join(os.tmpdir(), `ai-daily-report-index-${process.pid}`);
    const env = { GIT_INDEX_FILE: tmpIndex };

    try {
      // 3. Seed the isolated index with the data branch's current tree
      await git(['read-tree', `refs/remotes/origin/${DATA_BRANCH}`], { env });

      // 4. Stage our paths. -f bypasses main's .gitignore, which excludes
      //    data/ on main but not on the data branch.
      for (const p of addPaths) {
        if (fs.existsSync(p)) {
          await git(['add', '--force', '--', p], { env });
        }
      }

      // 5. Materialize the tree
      const newTree = (await git(['write-tree'], { env })).stdout;

      // 6. Skip the push if the tree matches the parent — nothing changed
      const parentTree = (await git(['rev-parse', `refs/remotes/origin/${DATA_BRANCH}^{tree}`]))
        .stdout;
      if (newTree === parentTree) {
        console.error('[commit] no changes to commit — skipping push');
        return { pushed: false, sha: null };
      }

      // 7. Commit on top of the data branch tip
      const parent = (await git(['rev-parse', `refs/remotes/origin/${DATA_BRANCH}`])).stdout;
      const commit = (await git(['commit-tree', newTree, '-p', parent, '-m', commitMsg])).stdout;

      // 8. Push to refs/heads/data
      await git(['push', 'origin', `${commit}:refs/heads/${DATA_BRANCH}`]);

      const shortSha = commit.slice(0, 7);
      console.error(`[commit] pushed ${shortSha} to origin/${DATA_BRANCH}`);
      return { pushed: true, sha: shortSha };
    } finally {
      if (fs.existsSync(tmpIndex)) fs.unlinkSync(tmpIndex);
    }
  } finally {
    if (process.env.GITHUB_TOKEN) {
      await git(['remote', 'set-url', 'origin', REMOTE_URL], { reject: false });
    }
  }
}

// CLI: `node src/lib/commit.js <date> <message> <path> [path ...]`
const isMain = import.meta.url === `file://${path.resolve(process.argv[1] ?? '')}`;
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
export const _internals = { git, ensureGitAuthor, tokenizedRemoteUrl };
