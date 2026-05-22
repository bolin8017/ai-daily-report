import RSSParser from 'rss-parser';
import { defineProvider } from './_registry.js';

const parser = new RSSParser({
  timeout: 20_000,
  headers: { 'User-Agent': 'ai-daily-report/1.0' },
});

const PER_CATEGORY_CAP = 50;
const ABSTRACT_MAX_CHARS = 400;

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
