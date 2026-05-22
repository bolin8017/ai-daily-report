import * as cheerio from 'cheerio';
import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Last-resort fallback: scrapes github.com/search?type=users. Cannot reconstruct
// full API parity (regional buckets, newest-repo enrichment) from HTML alone —
// if this tier is reached, the report's developer list is intentionally minimal.
export async function githubDevelopersHtmlProvider(cfg, _ctx) {
  const query = cfg.query ?? 'followers:>1000';
  const url = `https://github.com/search?type=users&q=${encodeURIComponent(query)}&s=followers&o=desc`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const $ = cheerio.load(await res.text());
    const users = [];
    $('a[href^="/"][data-hovercard-type="user"]').each((_, el) => {
      const u = $(el).attr('href').replace(/^\//, '');
      if (u && !u.includes('/')) users.push(u);
    });
    const items = [...new Set(users)].slice(0, cfg.limit ?? 20).map((u, i) => ({
      full_name: `${u}/_user`,
      url: `https://github.com/${u}`,
      description: null,
      language: null,
      stars: 0,
      rank: i + 1,
    }));
    return { ok: items.length > 0, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('github-developers-html', githubDevelopersHtmlProvider);
