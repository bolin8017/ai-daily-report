// Shared GitHub helpers used by github-trending / github-search /
// github-developers. Centralizes Octokit construction and README excerpt
// fetching so adding caching, retry policy, or rate-limit telemetry only
// touches one file.

import { Octokit } from 'octokit';
import { stripControlChars } from './text-utils.js';

const DEFAULT_USER_AGENT = 'ai-daily-report/1.0';
const README_EXCERPT_CHARS = 500;

/**
 * Builds an Octokit client. Lazy construction (called from inside each
 * fetcher's main function) avoids requiring GITHUB_TOKEN to be set just
 * to import a module for a test.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.requireAuth] - throw if GITHUB_TOKEN missing
 * @returns {Octokit}
 */
export function makeOctokit({ requireAuth = false } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (requireAuth && !token) {
    throw new Error('GITHUB_TOKEN is required for this fetcher');
  }
  return new Octokit({
    auth: token || undefined,
    userAgent: DEFAULT_USER_AGENT,
    // Throttle plugin is bundled in the `octokit` meta package and defaults to
    // retrying on secondary rate limits — that can stall the pipeline for
    // many minutes when README enrichment hits the per-content secondary cap.
    // Fail-fast instead: getReadmeExcerpt's catch returns '' on any error, so
    // the repo item is still emitted (just without README) rather than the
    // whole pipeline waiting on rate-limit reset.
    throttle: {
      onRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(
          `[github] core rate-limit hit on ${options.method} ${options.url} (retry-after=${retryAfter}s) — failing fast`,
        );
        return false;
      },
      onSecondaryRateLimit: (_retryAfter, options, octokit) => {
        octokit.log.warn(
          `[github] secondary rate-limit hit on ${options.method} ${options.url} — failing fast`,
        );
        return false;
      },
    },
  });
}

/**
 * Fetch the recursive file-path list of a repo's tree in ONE API call.
 * Returns [] on any error (fail-soft, consistent with getReadmeExcerpt).
 * @returns {Promise<string[]>} repo-relative paths
 */
export async function getRepoTree(octokit, owner, repo, defaultBranch, logPrefix = 'github') {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch || 'HEAD',
      recursive: 'true',
    });
    return (data.tree ?? []).map((t) => t.path).filter(Boolean);
  } catch (err) {
    console.error(`[${logPrefix}] getRepoTree(${owner}/${repo}) failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetches the raw README, strips control chars, truncates to 500 chars.
 * Returns '' on any error (missing README, private repo, rate limit) so
 * callers can keep the enriched item rather than dropping it entirely.
 *
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} [logPrefix='github']
 * @returns {Promise<string>}
 */
export async function getReadmeExcerpt(octokit, owner, repo, logPrefix = 'github') {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' },
    });
    return stripControlChars(String(data)).slice(0, README_EXCERPT_CHARS);
  } catch (err) {
    console.error(`[${logPrefix}] getReadmeExcerpt(${owner}/${repo}) failed: ${err.message}`);
    return '';
  }
}

/**
 * Fetch the most recent commits for a repo, normalized to {login, date, message}.
 * `message` is the first line only. Returns [] on any error (fail-soft) so the
 * behavioral-signal enrichment degrades gracefully and never aborts the funnel.
 *
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} [perPage=30]
 * @param {string} [logPrefix='github']
 * @returns {Promise<{ login: string|null, date: string|null, message: string }[]>}
 */
export async function getRecentCommits(octokit, owner, repo, perPage = 30, logPrefix = 'github') {
  try {
    const { data } = await octokit.rest.repos.listCommits({ owner, repo, per_page: perPage });
    return (data ?? []).map((c) => ({
      login: c.author?.login ?? c.commit?.author?.name ?? null,
      date: c.commit?.author?.date ?? null,
      message: (c.commit?.message ?? '').split('\n')[0],
    }));
  } catch (err) {
    console.error(`[${logPrefix}] getRecentCommits(${owner}/${repo}) failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch the contributor list for a repo, normalized to {login, contributions}.
 * Returns [] on any error (fail-soft).
 *
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} [logPrefix='github']
 * @returns {Promise<{ login: string|null, contributions: number }[]>}
 */
export async function getContributors(octokit, owner, repo, logPrefix = 'github') {
  try {
    const { data } = await octokit.rest.repos.listContributors({ owner, repo, per_page: 30 });
    return (data ?? []).map((u) => ({
      login: u.login ?? null,
      contributions: u.contributions ?? 0,
    }));
  } catch (err) {
    console.error(`[${logPrefix}] getContributors(${owner}/${repo}) failed: ${err.message}`);
    return [];
  }
}
