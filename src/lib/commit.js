// Git commit + push for the daily report pipeline.
//
// Auth strategy: if `GITHUB_TOKEN` is set, embeds it in the push URL via
// `x-access-token:TOKEN@github.com`. Otherwise relies on the host's
// configured credential helper or SSH keys.
//
// Commit only runs if data/reports/, data/memory.json, or data/feeds-snapshot.json
// actually changed. `git push origin HEAD:main` is used instead of `main` so
// detached-HEAD clones (e.g., a fresh container clone) work too.

import { spawn } from 'node:child_process';

const REMOTE_URL = 'https://github.com/bolin8017/ai-daily-report.git';

function git(args, { reject = true, env } = {}) {
  return new Promise((resolve, rejectPromise) => {
    const proc = spawn('git', args, { env: { ...process.env, ...(env ?? {}) } });
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
  // x-access-token is GitHub's convention for PAT-based Basic auth
  return REMOTE_URL.replace('https://', `https://x-access-token:${token}@`);
}

function sanitizeToken(str) {
  if (!process.env.GITHUB_TOKEN) return str;
  return str.replaceAll(process.env.GITHUB_TOKEN, '***');
}

/**
 * Commit data changes and push to origin main.
 * @param {object} opts
 * @param {string} opts.date - YYYY-MM-DD for the commit message
 * @param {string} [opts.message] - custom commit message (default: "report: {date} daily creative brief")
 * @param {string[]} [opts.paths] - files/dirs to git-add (default: report + memory + snapshot)
 * @returns {Promise<{ pushed: boolean, sha: string | null }>}
 */
export async function commitAndPush({ date, message, paths }) {
  await ensureGitAuthor();

  const addPaths = paths ?? ['data/reports/', 'data/memory.json', 'data/feeds-snapshot.json'];
  await git(['add', ...addPaths]);

  const diff = await git(['diff', '--cached', '--quiet'], { reject: false });
  // exit 0 = no diff, exit 1 = diff present
  if (diff.code === 0) {
    console.error('[commit] no changes to commit — skipping push');
    return { pushed: false, sha: null };
  }

  const commitMsg = message ?? `report: ${date} daily creative brief`;
  await git(['commit', '-m', commitMsg]);

  if (process.env.GITHUB_TOKEN) {
    await git(['remote', 'set-url', 'origin', tokenizedRemoteUrl(process.env.GITHUB_TOKEN)]);
  }
  try {
    await git(['push', 'origin', 'HEAD:main']);
  } finally {
    // Always scrub token from git config, even on push failure
    if (process.env.GITHUB_TOKEN) {
      await git(['remote', 'set-url', 'origin', REMOTE_URL], { reject: false });
    }
  }

  const sha = (await git(['rev-parse', '--short', 'HEAD'])).stdout;
  console.error(`[commit] pushed ${sha} to origin/main`);
  return { pushed: true, sha };
}

// Exported for tests
export const _internals = { git, ensureGitAuthor, tokenizedRemoteUrl };
