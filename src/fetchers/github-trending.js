#!/usr/bin/env node

// GitHub Trending fetcher — scrape trending page with cheerio + enrich via Octokit.
//
// Two usage modes:
//   - Import: `import { fetchTrending } from './github-trending.js'`
//   - Standalone: `node src/fetchers/github-trending.js > tmp/github-trending.json`

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { Octokit } from 'octokit';
import { runAsStandalone } from './_dispatch.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(__filename);

// GitHub's trending page typically shows 25 repos. We scrape all of them and let
// the agent pick what matters. Not config-driven — if you want fewer, slice later.
const LIMIT = 25;
const TIMEOUT = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const octokit = process.env.GITHUB_TOKEN
  ? new Octokit({ auth: process.env.GITHUB_TOKEN, userAgent: 'ai-daily-report/1.0' })
  : new Octokit({ userAgent: 'ai-daily-report/1.0' });

async function scrapeTrendingRepos() {
  const res = await fetch('https://github.com/trending', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from github.com/trending`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Each trending repo is in an <article class="Box-row"> with an <h2 class="h3 lh-condensed"> containing the link.
  const repos = [];
  $('article.Box-row h2.h3 a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const fullName = href.replace(/^\//, '').trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
      repos.push(fullName);
    }
  });

  // Dedupe while preserving order
  return [...new Set(repos)].slice(0, LIMIT);
}

async function enrichRepo(fullName, rank) {
  const [owner, repo] = fullName.split('/');
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    let readmeExcerpt = '';
    try {
      const readmeRes = await octokit.rest.repos.getReadme({
        owner,
        repo,
        mediaType: { format: 'raw' },
      });
      readmeExcerpt = String(readmeRes.data).slice(0, 500);
    } catch {
      // README missing or rate-limited — leave blank
    }

    return {
      source: 'github-trending',
      full_name: data.full_name,
      url: data.html_url,
      description: data.description ?? '',
      language: data.language,
      stars: data.stargazers_count,
      forks: data.forks_count,
      open_issues: data.open_issues_count,
      created_at: data.created_at,
      pushed_at: data.pushed_at,
      readme_excerpt: readmeExcerpt,
      rank,
    };
  } catch (err) {
    // Repo lookup failed (deleted, private, rate-limited) — return minimal entry
    return {
      source: 'github-trending',
      full_name: fullName,
      url: `https://github.com/${fullName}`,
      description: '',
      language: null,
      stars: 0,
      forks: 0,
      readme_excerpt: '',
      rank,
      _error: err.message,
    };
  }
}

export async function fetchTrending() {
  const repos = await scrapeTrendingRepos();

  if (repos.length === 0) {
    throw new Error('No trending repos found — GitHub HTML structure may have changed');
  }

  // Enrich in batches of 5 to respect rate limits
  const items = [];
  for (let i = 0; i < repos.length; i += 5) {
    const batch = repos.slice(i, i + 5);
    const enriched = await Promise.all(batch.map((name, j) => enrichRepo(name, i + j + 1)));
    items.push(...enriched);
  }

  // If most enrichments failed (e.g., auth revoked), signal degraded state
  const failed = items.filter((i) => i._error).length;
  const ok = failed < items.length * 0.5;
  if (!ok) {
    console.error(
      `[${SCRIPT_NAME}] ${failed}/${items.length} enrichments failed — likely auth/rate issue`,
    );
  }

  return { ok, items, degraded: failed || undefined };
}

runAsStandalone(import.meta.url, fetchTrending);
