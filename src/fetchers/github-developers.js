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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from 'octokit';
import { runAsStandalone } from './_dispatch.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf8'));

const DEV_CONFIG = config.sources.github_developers;
const GLOBAL_LIMIT = DEV_CONFIG.global_limit ?? 100;
const GLOBAL_MIN_FOLLOWERS = DEV_CONFIG.global_min_followers ?? 1000;
const NEW_REPO_WINDOW_HOURS = DEV_CONFIG.new_repo_window_hours ?? 48;
const REGIONS = DEV_CONFIG.regions ?? [];

// Octokit is created lazily inside fetchDevelopers so importing this module
// does not require GITHUB_TOKEN to be set.
let octokit;
let cutoffMs;

async function searchUsers(query, perPage) {
  try {
    const { data } = await octokit.rest.search.users({
      q: query,
      sort: 'followers',
      order: 'desc',
      per_page: Math.min(perPage, 100),
    });
    return (data.items || []).map((u) => ({ login: u.login }));
  } catch (err) {
    console.error(`[github-developers] search failed for "${query}": ${err.message}`);
    return [];
  }
}

async function getNewestRepo(login) {
  try {
    const { data } = await octokit.rest.repos.listForUser({
      username: login,
      sort: 'created',
      direction: 'desc',
      per_page: 1,
    });
    return data[0] || null;
  } catch {
    return null;
  }
}

// Strip C0 control characters except tab/LF/CR. Defends against pathological
// READMEs that contain null bytes or other control bytes which break JSON
// encoders downstream. Implemented as a charCodeAt loop instead of a regex
// to keep the linter happy without needing biome-ignore pragmas on every
// char-class entry.
function stripControlChars(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      out += s[i];
    }
  }
  return out;
}

async function getReadmeExcerpt(owner, repo) {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' },
    });
    return stripControlChars(String(data)).slice(0, 500);
  } catch {
    return '';
  }
}

async function getFollowerCount(login) {
  try {
    const { data } = await octokit.rest.users.getByUsername({ username: login });
    return data.followers || 0;
  } catch {
    return 0;
  }
}

async function processUser(login, region) {
  const repo = await getNewestRepo(login);
  if (!repo?.created_at) return null;

  const repoMs = new Date(repo.created_at).getTime();
  if (Number.isNaN(repoMs) || repoMs < cutoffMs) return null;

  const followers = await getFollowerCount(login);
  const [owner, name] = (repo.full_name || '').split('/');
  const readmeExcerpt = owner && name ? await getReadmeExcerpt(owner, name) : '';

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

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required for github-developers fetcher');
  }

  octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    userAgent: 'ai-daily-report/1.0',
  });
  cutoffMs = Date.now() - NEW_REPO_WINDOW_HOURS * 60 * 60 * 1000;

  const seen = new Set();
  const queue = []; // { login, region }

  // Step 1a: global top developers by followers
  const globalUsers = await searchUsers(`followers:>${GLOBAL_MIN_FOLLOWERS}`, GLOBAL_LIMIT);
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
      const users = await searchUsers(`followers:>${minFollowers} location:${location}`, limit);
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
    const results = await Promise.all(batch.map((e) => processUser(e.login, e.region)));
    for (const r of results) if (r) items.push(r);
  }

  return { ok: true, items };
}

runAsStandalone(import.meta.url, fetchDevelopers);
