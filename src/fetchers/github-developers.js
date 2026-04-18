#!/usr/bin/env node

// GitHub Developers fetcher — finds top developers (global + regional) and
// returns their newest repos created within a recent time window.
//
// Replaces scripts/fetch/github-developers.sh (273 lines of curl + jq).
// Octokit's @octokit/plugin-throttling and @octokit/plugin-retry (bundled in
// the `octokit` meta-package) handle rate limiting and transient failures.
//
// Two usage modes:
//   - Import: `import { fetchDevelopers } from './github-developers.js'`
//   - Standalone: `node src/fetchers/github-developers.js > tmp/github-developers.json`

import config from '../lib/config.js';
import { getReadmeExcerpt, makeOctokit } from '../lib/github.js';
import { runAsStandalone } from './_dispatch.js';

const LOG_PREFIX = 'github-developers';
const DEV_CONFIG = config.sources.github_developers;
const GLOBAL_LIMIT = DEV_CONFIG.global_limit ?? 100;
const GLOBAL_MIN_FOLLOWERS = DEV_CONFIG.global_min_followers ?? 1000;
const NEW_REPO_WINDOW_HOURS = DEV_CONFIG.new_repo_window_hours ?? 48;
const REGIONS = DEV_CONFIG.regions ?? [];

async function searchUsers(octokit, query, perPage) {
  try {
    const { data } = await octokit.rest.search.users({
      q: query,
      sort: 'followers',
      order: 'desc',
      per_page: Math.min(perPage, 100),
    });
    return (data.items || []).map((u) => ({ login: u.login }));
  } catch (err) {
    console.error(`[${LOG_PREFIX}] search failed for "${query}": ${err.message}`);
    return [];
  }
}

async function getNewestRepo(octokit, login) {
  try {
    const { data } = await octokit.rest.repos.listForUser({
      username: login,
      sort: 'created',
      direction: 'desc',
      per_page: 1,
    });
    return data[0] || null;
  } catch (err) {
    console.error(`[${LOG_PREFIX}] getNewestRepo(${login}) failed: ${err.message}`);
    return null;
  }
}

async function getFollowerCount(octokit, login) {
  try {
    const { data } = await octokit.rest.users.getByUsername({ username: login });
    return data.followers || 0;
  } catch (err) {
    console.error(`[${LOG_PREFIX}] getFollowerCount(${login}) failed: ${err.message}`);
    return 0;
  }
}

async function processUser(octokit, cutoffMs, login, region) {
  const repo = await getNewestRepo(octokit, login);
  if (!repo?.created_at) return null;

  const repoMs = new Date(repo.created_at).getTime();
  if (Number.isNaN(repoMs) || repoMs < cutoffMs) return null;

  const followers = await getFollowerCount(octokit, login);
  const [owner, name] = (repo.full_name || '').split('/');
  const readmeExcerpt =
    owner && name ? await getReadmeExcerpt(octokit, owner, name, LOG_PREFIX) : '';

  return {
    source: 'github-developers',
    developer: login,
    developer_url: `https://github.com/${login}`,
    developer_followers: followers,
    developer_region: region,
    full_name: repo.full_name || '',
    url: repo.html_url || '',
    description: repo.description || '',
    language: repo.language || null,
    stars: repo.stargazers_count || 0,
    created_at: repo.created_at,
    created_hours_ago: Math.floor((Date.now() - repoMs) / (60 * 60 * 1000)),
    readme_excerpt: readmeExcerpt,
  };
}

export async function fetchDevelopers() {
  if (!DEV_CONFIG.enabled) {
    return { ok: true, items: [] };
  }

  const octokit = makeOctokit({ requireAuth: true });
  const cutoffMs = Date.now() - NEW_REPO_WINDOW_HOURS * 60 * 60 * 1000;

  const seen = new Set();
  const queue = []; // { login, region }

  // Step 1a: global top developers by followers
  const globalUsers = await searchUsers(
    octokit,
    `followers:>${GLOBAL_MIN_FOLLOWERS}`,
    GLOBAL_LIMIT,
  );
  for (const u of globalUsers) {
    if (seen.has(u.login)) continue;
    seen.add(u.login);
    queue.push({ login: u.login, region: 'global' });
  }

  // Step 1b: regional developers (e.g., Taiwan)
  for (const region of REGIONS) {
    const minFollowers = region.min_followers ?? 50;
    const limit = region.limit ?? 50;
    for (const location of region.locations || []) {
      if (!location) continue;
      const users = await searchUsers(
        octokit,
        `followers:>${minFollowers} location:${location}`,
        limit,
      );
      for (const u of users) {
        if (seen.has(u.login)) continue;
        seen.add(u.login);
        queue.push({ login: u.login, region: region.name });
      }
    }
  }

  // Step 2: process developers in batches of 5. Sequential per batch keeps
  // burst rates polite; Octokit's throttling plugin auto-backs off if we
  // bump the secondary rate limit anyway.
  const items = [];
  const BATCH = 5;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((e) => processUser(octokit, cutoffMs, e.login, e.region)),
    );
    for (const r of results) if (r) items.push(r);
  }

  // If we checked users but found zero items, something is likely wrong
  // (rate limiting, auth issues). Report as degraded.
  const ok = queue.length === 0 || items.length > 0;
  return { ok, items, users_checked: queue.length };
}

runAsStandalone(import.meta.url, fetchDevelopers);
