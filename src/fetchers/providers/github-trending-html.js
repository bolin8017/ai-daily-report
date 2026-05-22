import * as cheerio from 'cheerio';
import { getReadmeExcerpt, makeOctokit } from '../../lib/github.js';
import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeTrending(url, limit) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const repos = [];
  $('article.Box-row h2.h3 a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const fullName = href.replace(/^\//, '').trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) repos.push(fullName);
  });
  return [...new Set(repos)].slice(0, limit);
}

async function enrichRepo(octokit, fullName, rank) {
  const [owner, repo] = fullName.split('/');
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    const readme = await getReadmeExcerpt(octokit, owner, repo, 'github-trending');
    return {
      full_name: fullName,
      url: data.html_url,
      description: data.description ?? null,
      language: data.language ?? null,
      stars: data.stargazers_count ?? 0,
      stars_today: null,
      forks: data.forks_count ?? 0,
      topics: data.topics ?? [],
      readme_excerpt: readme ?? '',
      rank,
    };
  } catch {
    return null;
  }
}

export async function githubTrendingHtmlProvider(cfg, _ctx) {
  const limit = cfg.limit ?? 25;
  try {
    const repoNames = await scrapeTrending(cfg.url ?? 'https://github.com/trending', limit);
    if (repoNames.length === 0) {
      return { ok: false, items: [], error: 'no repos parsed from trending page' };
    }
    const octokit = makeOctokit();
    const enriched = await Promise.all(repoNames.map((n, i) => enrichRepo(octokit, n, i + 1)));
    const items = enriched.filter(Boolean);
    return {
      ok: items.length > 0,
      items,
      error: items.length === 0 ? 'enrichment failed' : undefined,
    };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('github-trending-html', githubTrendingHtmlProvider);
