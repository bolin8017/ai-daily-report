import RSSParser from 'rss-parser';
import { arxivKeywords, loadInterests } from '../../lib/interests.js';
import { defineProvider } from './_registry.js';

const parser = new RSSParser({ timeout: 20_000, headers: { 'User-Agent': 'ai-daily-report/1.0' } });
const ABSTRACT_MAX_CHARS = 400;
const MAX_RESULTS = 30;
const ARXIV_CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.IR'];
const MAX_KEYWORDS = 40;
const API_BASE = 'https://export.arxiv.org/api/query';
const RETRIES = 2;
const RETRY_BASE_DELAY_MS = 3_000;

// arXiv's export API throttles bursts with HTTP 429 (and occasionally 503). It
// asks for ~1 request / 3s, so a transient throttle should be retried with
// exponential backoff rather than failing the whole source on a single 429 —
// the 2026-06-07 run lost arxiv-cs-ai entirely to a one-off 429.
const RETRYABLE_STATUS_RE = /\b(429|503)\b/;

async function fetchFeedWithRetry(fetchFeed, url, { retries, baseDelayMs, sleep }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchFeed(url);
    } catch (err) {
      if (attempt >= retries || !RETRYABLE_STATUS_RE.test(err?.message ?? '')) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

// Build an arxiv-API search_query (URL-encoded) from interest keywords:
//   (abs:"kw1" OR abs:kw2 OR ...) AND (cat:cs.AI OR cat:cs.CL OR ...)
// Multi-word phrases are quoted. Returns null when there are no keywords.
export function buildArxivSearchQuery(keywords, opts = {}) {
  const max = opts.maxKeywords ?? MAX_KEYWORDS;
  const cats = opts.categories ?? ARXIV_CATEGORIES;
  const kws = (keywords ?? []).filter(Boolean).slice(0, max);
  if (kws.length === 0) return null;
  const enc = (kw) => {
    const term = kw.includes(' ') ? `"${kw}"` : kw;
    return `abs:${encodeURIComponent(term).replace(/%20/g, '+')}`;
  };
  const kwClause = `(${kws.map(enc).join('+OR+')})`;
  const catClause = `(${cats.map((c) => `cat:${c}`).join('+OR+')})`;
  return `${kwClause}+AND+${catClause}`;
}

function parseEntry(entry) {
  const url = entry.link ?? (typeof entry.id === 'string' ? entry.id : (entry.id?.[''] ?? null));
  const paper_id = url?.match(/abs\/([^v]+)/)?.[1] ?? null;
  let authors = [];
  if (Array.isArray(entry.authors)) authors = entry.authors.map((a) => a.name ?? a);
  else if (entry.author) {
    const a = entry.author;
    authors = Array.isArray(a) ? a.map((x) => x.name ?? x) : [a.name ?? a];
  } else if (entry['dc:creator']) authors = String(entry['dc:creator']).split(/,\s*/);
  let cats = [];
  if (Array.isArray(entry.categories)) {
    cats = entry.categories.flatMap((c) => (typeof c === 'string' ? [c] : c?._ ? [c._] : []));
  }
  const abstract = (entry.summary ?? entry.contentSnippet ?? entry.content ?? '').trim();
  return {
    paper_id,
    url: url ?? 'https://arxiv.org/',
    title: (entry.title ?? '').trim().replace(/\s+/g, ' '),
    abstract:
      abstract.length > ABSTRACT_MAX_CHARS
        ? `${abstract.slice(0, ABSTRACT_MAX_CHARS)}...`
        : abstract,
    authors,
    categories: cats,
    published: entry.isoDate ?? entry.published ?? entry.pubDate ?? null,
  };
}

export function parseArxivEntries(parsed) {
  return (parsed.items ?? []).map(parseEntry);
}

export async function arxivRssProvider(cfg = {}, ctx = {}) {
  let keywords = cfg.keywords;
  if (!keywords) {
    try {
      keywords = arxivKeywords(await loadInterests());
    } catch (err) {
      return { ok: false, items: [], error: `interests load failed: ${err.message}` };
    }
  }
  const query = buildArxivSearchQuery(keywords, {
    maxKeywords: cfg.maxKeywords ?? MAX_KEYWORDS,
    categories: cfg.categories ?? ARXIV_CATEGORIES,
  });
  if (!query) return { ok: false, items: [], error: 'no arxiv keywords (all interests off?)' };

  const max = cfg.maxResults ?? MAX_RESULTS;
  const url = `${API_BASE}?search_query=${query}&start=0&max_results=${max}&sortBy=submittedDate&sortOrder=descending`;
  const fetchFeed = ctx._fetchFeed ?? ((u) => parser.parseURL(u));
  const sleep = ctx._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  try {
    const parsed = await fetchFeedWithRetry(fetchFeed, url, {
      retries: cfg.retries ?? RETRIES,
      baseDelayMs: cfg.retryDelayMs ?? RETRY_BASE_DELAY_MS,
      sleep,
    });
    const items = parseArxivEntries(parsed).slice(0, max); // defensive cap (max_results already bounds the API)
    return { ok: items.length > 0, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('arxiv-rss', arxivRssProvider);
