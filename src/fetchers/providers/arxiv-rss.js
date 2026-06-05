import RSSParser from 'rss-parser';
import { defineProvider } from './_registry.js';

const parser = new RSSParser({
  timeout: 20_000,
  headers: { 'User-Agent': 'ai-daily-report/1.0' },
});

const PER_CATEGORY_CAP = 50;
const ABSTRACT_MAX_CHARS = 400;
const ARXIV_CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.IR'];
const MAX_KEYWORDS = 40;

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

function parseEntry(entry, category) {
  const url = entry.link ?? (typeof entry.id === 'string' ? entry.id : (entry.id?.[''] ?? null));
  const paper_id = url?.match(/abs\/([^v]+)/)?.[1] ?? null;
  let authors = [];
  if (Array.isArray(entry.authors)) authors = entry.authors.map((a) => a.name ?? a);
  else if (entry.author) {
    const a = entry.author;
    authors = Array.isArray(a) ? a.map((x) => x.name ?? x) : [a.name ?? a];
  } else if (entry['dc:creator']) authors = String(entry['dc:creator']).split(/,\s*/);
  else if (entry.creator) authors = String(entry.creator).split(/,\s*/);

  let cats = [];
  if (Array.isArray(entry.categories)) {
    cats = entry.categories.flatMap((c) => (typeof c === 'string' ? [c] : c?._ ? [c._] : []));
  }
  if (cats.length === 0 && category) cats = [category];

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

export async function arxivRssProvider(cfg, _ctx) {
  const feeds = cfg.feeds ?? [
    { category: 'cs.LG', url: 'https://export.arxiv.org/rss/cs.LG' },
    { category: 'cs.CL', url: 'https://export.arxiv.org/rss/cs.CL' },
  ];
  try {
    const all = [];
    for (const feed of feeds) {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items ?? []).slice(0, PER_CATEGORY_CAP);
      for (const entry of items) {
        all.push(parseEntry(entry, feed.category));
      }
    }
    return { ok: all.length > 0, items: all };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('arxiv-rss', arxivRssProvider);
