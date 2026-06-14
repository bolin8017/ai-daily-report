import { getReadmeExcerpt, makeOctokit } from '../../lib/github.js';
import { getThemeSources } from '../../lib/theme.js';
import { defineProvider } from './_registry.js';

const LOG_PREFIX = 'github-developers';

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
    forks: repo.forks_count ?? 0,
    default_branch: repo.default_branch || null,
    license: repo.license?.spdx_id ?? null,
    fork: repo.fork ?? false,
  };
}

export async function githubDevelopersApiProvider(_cfg, _ctx) {
  const themeSources = await getThemeSources();
  const DEV_CONFIG = themeSources.github_developers;
  if (!DEV_CONFIG.enabled) {
    return { ok: true, items: [] };
  }

  const GLOBAL_LIMIT = DEV_CONFIG.global_limit ?? 100;
  const GLOBAL_MIN_FOLLOWERS = DEV_CONFIG.global_min_followers ?? 1000;
  const NEW_REPO_WINDOW_HOURS = DEV_CONFIG.new_repo_window_hours ?? 48;
  const REGIONS = DEV_CONFIG.regions ?? [];

  const octokit = makeOctokit({ requireAuth: true });
  const cutoffMs = Date.now() - NEW_REPO_WINDOW_HOURS * 60 * 60 * 1000;

  const seen = new Set();
  const queue = [];

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

  const items = [];
  const BATCH = 5;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((e) => processUser(octokit, cutoffMs, e.login, e.region)),
    );
    for (const r of results) if (r) items.push(r);
  }

  const ok = queue.length === 0 || items.length > 0;
  return { ok, items, users_checked: queue.length };
}

defineProvider('github-developers-api', githubDevelopersApiProvider);
