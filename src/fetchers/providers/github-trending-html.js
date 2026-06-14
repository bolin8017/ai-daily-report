import * as cheerio from 'cheerio';
import { getReadmeExcerpt, makeOctokit } from '../../lib/github.js';
import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function parseStarsToday(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/([\d,]+)\s+stars?\s+today/i);
  if (!m) return null;
  const n = Number.parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function extractRows($) {
  const rows = [];
  const seen = new Set();
  $('article.Box-row').each((_, row) => {
    const href = $(row).find('h2.h3 a').attr('href');
    if (!href) return;
    const fullName = href.replace(/^\//, '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return;
    if (seen.has(fullName)) return;
    seen.add(fullName);
    rows.push({ fullName, starsToday: parseStarsToday($(row).text()) });
  });
  return rows;
}

async function scrapeTrending(url, limit) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  return extractRows($).slice(0, limit);
}

async function enrichRepo(octokit, fullName, rank, starsToday = null) {
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
      stars_today: starsToday,
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
    const rows = await scrapeTrending(cfg.url ?? 'https://github.com/trending', limit);
    if (rows.length === 0) {
      return { ok: false, items: [], error: 'no repos parsed from trending page' };
    }
    const octokit = makeOctokit();
    const enriched = await Promise.all(
      rows.map((r, i) => enrichRepo(octokit, r.fullName, i + 1, r.starsToday)),
    );
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
