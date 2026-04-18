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
  });
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
