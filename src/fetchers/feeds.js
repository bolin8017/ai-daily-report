#!/usr/bin/env node

// Unified feed fetcher — RSSHub JSON Feed + native RSS/Atom + JSON APIs
//
// Two usage modes:
//   - Import: `import { fetchFeeds } from './feeds.js'` → returns result object
//   - Standalone: `node src/fetchers/feeds.js > tmp/unified-feeds.json`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RSSParser from 'rss-parser';
import { runAsStandalone } from './_dispatch.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf8'));

const RSSHUB_URL = (
  process.env.RSSHUB_URL ||
  config.sources.rsshub_url ||
  'https://rsshub.pseudoyu.com'
).replace(/\/$/, '');
const TIMEOUT = 30_000;

// --- Helpers ---

function stripHTML(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[^;]+;/g, ' ')
    .trim();
}

function extractHref(html, linkText) {
  const m = html?.match(new RegExp(`<a[^>]+href="([^"]+)"[^>]*>[^<]*${linkText}`, 'i'));
  return m?.[1] || null;
}

// --- Fetchers ---

async function fetchRSSHubJSON(route, limit) {
  const url = `${RSSHUB_URL}${route}?format=json&limit=${limit || 30}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'ai-daily-report/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await res.json();
  return feed.items || [];
}

async function fetchNativeRSS(feedUrl, limit) {
  // Use fetch() for the HTTP request instead of rss-parser's built-in
  // http.get/https.get. In CCR, all outbound traffic goes through an HTTPS
  // proxy (https_proxy env var). Node's fetch() respects this proxy when
  // NODE_USE_ENV_PROXY=1 is set, but http.get/https.get do NOT. Using
  // fetch() + parseString() ensures RSS feeds work through the proxy.
  const res = await fetch(feedUrl, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'ai-daily-report/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new RSSParser();
  const feed = await parser.parseString(xml);
  return (feed.items || []).slice(0, limit || 20);
}

async function fetchJSONAPI(apiUrl, limit) {
  const res = await fetch(apiUrl, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, limit || 30) : [];
}

// --- HN Algolia enrichment (scores + comments) ---
//
// Best-effort: individual failures are logged to stderr but not fatal — a few
// items without scores is better than aborting the whole fetch.
async function enrichHNItems(items) {
  const hnItems = items.filter((i) => i.source === 'hackernews' && i.hn_id);
  if (!hnItems.length) return items;

  // Parallel batches of 10 to avoid hammering Algolia
  const BATCH = 10;
  let failed = 0;
  for (let i = 0; i < hnItems.length; i += BATCH) {
    const batch = hnItems.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(async (item) => {
        try {
          const res = await fetch(`https://hn.algolia.com/api/v1/items/${item.hn_id}`, {
            signal: AbortSignal.timeout(10_000),
            headers: { 'User-Agent': 'ai-daily-report/1.0' },
          });
          if (!res.ok) {
            failed++;
            return;
          }
          const data = await res.json();
          item.score = data.points || 0;
          item.num_comments = data.children?.length || 0;
          // Grab top 3 comments by points
          const kids = (data.children || [])
            .filter((c) => c.text && c.author)
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 3);
          item.comments = kids.map((c) => ({
            text: c.text?.replace(/<[^>]*>/g, '').slice(0, 500) || '',
            score: c.points || 0,
            by: c.author || '',
          }));
        } catch (err) {
          failed++;
          console.error(`[feeds.js] HN enrichment failed for id=${item.hn_id}: ${err.message}`);
        }
      }),
    );
  }
  if (failed > hnItems.length * 0.5) {
    console.error(
      `[feeds.js] WARN: ${failed}/${hnItems.length} HN Algolia enrichments failed — scores will be missing from report`,
    );
  }
  return items;
}

// --- Normalizers (per source type) ---
//
// Note: there is no normalizeGitHubTrending here. GitHub Trending has its own
// dedicated fetcher (src/fetchers/github-trending.js) using cheerio + Octokit,
// which is far more robust than parsing RSSHub's stripped HTML.

function normalizeHN(item, rank) {
  const sourceUrl =
    extractHref(item.content_html, 'Source') || extractHref(item.content_html, 'Original');
  const hnUrl = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
  return {
    source: 'hackernews',
    title: item.title || '',
    url: sourceUrl || hnUrl,
    hn_url: hnUrl,
    hn_id: String(item.id || '').replace(/\D/g, ''),
    author: item.authors?.[0]?.name || '',
    published: item.date_published || null,
    rank,
  };
}

function normalizeRSSHub(item, feedName, category, rank) {
  return {
    source: feedName,
    category,
    title: item.title || '',
    url: item.url || item.id || '',
    description: (item.content_text || stripHTML(item.content_html) || '').slice(0, 500),
    author: item.authors?.[0]?.name || '',
    published: item.date_published || null,
    tags: item.tags || [],
    rank,
  };
}

function normalizeLobsters(item, rank) {
  return {
    source: 'Lobsters',
    category: 'community',
    title: item.title || '',
    url: item.url || '',
    discussion_url: item.comments_url || `https://lobste.rs/s/${item.short_id}`,
    description: (item.description || '').slice(0, 500),
    author: item.submitter_user?.username || item.submitter || '',
    score: item.score || 0,
    num_comments: item.comment_count || 0,
    tags: item.tags || [],
    published: item.created_at || null,
    rank,
  };
}

function coerceAuthor(raw) {
  // RSS/Atom feeds can return author as string, array, or object with {name: [...]}
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(coerceAuthor).filter(Boolean).join(', ');
  if (typeof raw === 'object') {
    const name = raw.name || raw.author || raw.displayName;
    if (Array.isArray(name)) return name[0] || '';
    if (typeof name === 'string') return name;
  }
  return '';
}

function coerceCategories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') return c._ || c.name || c.term || '';
      return '';
    })
    .filter(Boolean);
}

function normalizeNativeRSS(item, feedName, category, rank) {
  return {
    source: feedName,
    category,
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.link === 'string' ? item.link : '',
    description: (item.contentSnippet || stripHTML(item.content) || '').slice(0, 500),
    author: coerceAuthor(item.creator || item.author || item['dc:creator']),
    published: item.isoDate || item.pubDate || null,
    tags: coerceCategories(item.categories),
    rank,
  };
}

// --- Main ---

export async function fetchFeeds() {
  const feeds = (config.sources.feeds || []).filter((f) => f.enabled !== false);
  const allItems = [];
  const errors = [];
  let feedsOk = 0;

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        let rawItems, items;

        if (feed.type === 'rsshub') {
          rawItems = await fetchRSSHubJSON(feed.route, feed.limit);
          if (feed.normalize === 'hackernews') {
            items = rawItems.map((r, i) => normalizeHN(r, i + 1));
          } else {
            items = rawItems.map((r, i) => normalizeRSSHub(r, feed.name, feed.category, i + 1));
          }
        } else if (feed.type === 'json') {
          rawItems = await fetchJSONAPI(feed.url, feed.limit);
          if (feed.normalize === 'lobsters') {
            items = rawItems.map((r, i) => normalizeLobsters(r, i + 1));
          } else {
            items = rawItems.map((r, i) => normalizeRSSHub(r, feed.name, feed.category, i + 1));
          }
        } else {
          rawItems = await fetchNativeRSS(feed.url, feed.limit);
          items = rawItems.map((r, i) => normalizeNativeRSS(r, feed.name, feed.category, i + 1));
        }

        feedsOk++;
        return items;
      } catch (err) {
        errors.push({ feed: feed.name, error: err.message });
        return [];
      }
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  }

  // Enrich HN items with scores/comments from Algolia API
  await enrichHNItems(allItems);

  // Require at least half the configured feeds to succeed before declaring ok.
  // The previous threshold (`feedsOk > 0`) accepted 1/15 as healthy, which
  // hid systemic issues like RSSHub being completely down.
  const okThreshold = Math.max(1, Math.ceil(feeds.length / 2));

  return {
    ok: feedsOk >= okThreshold,
    items: allItems,
    feeds_ok: feedsOk,
    feeds_total: feeds.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

runAsStandalone(import.meta.url, fetchFeeds);
