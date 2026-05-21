#!/usr/bin/env node
// Fetcher: Arxiv cs.LG + cs.CL RSS feeds.
// Endpoint: https://export.arxiv.org/rss/cs.LG (and cs.CL).
// Uses rss-parser (already in dependencies) for consistency with feeds.js.

import Parser from 'rss-parser';
import { runAsStandalone } from './_dispatch.js';

const ARXIV_FEEDS = [
  { category: 'cs.LG', url: 'https://export.arxiv.org/rss/cs.LG' },
  { category: 'cs.CL', url: 'https://export.arxiv.org/rss/cs.CL' },
];

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'ai-daily-report/1.0' },
});

export function parseArxivEntry(entry) {
  // entry shapes:
  //   - rss-parser default: { title, link, isoDate, contentSnippet, creator, categories[] }
  //   - raw arxiv-style: { id: 'http://arxiv.org/abs/X', title, summary, authors, categories }
  const url = entry.link ?? (typeof entry.id === 'string' ? entry.id : (entry.id?.[''] ?? null));
  const paper_id = url?.match(/abs\/([^v]+)/)?.[1] ?? null;

  let authors = [];
  if (Array.isArray(entry.authors)) {
    authors = entry.authors.map((a) => a.name ?? a);
  } else if (entry.author) {
    const a = entry.author;
    authors = Array.isArray(a) ? a.map((x) => x.name ?? x) : [a.name ?? a];
  } else if (entry['dc:creator']) {
    authors = String(entry['dc:creator']).split(/,\s*/);
  } else if (entry.creator) {
    authors = String(entry.creator).split(/,\s*/);
  }

  let cats = [];
  if (Array.isArray(entry.categories)) {
    cats = entry.categories.flatMap((c) => (typeof c === 'string' ? [c] : c?._ ? [c._] : []));
  } else if (typeof entry.categories === 'string') {
    cats = entry.categories.split(/\s+/).filter(Boolean);
  }

  return {
    paper_id,
    url,
    title: (entry.title ?? '').trim().replace(/\s+/g, ' '),
    abstract: (entry.summary ?? entry.contentSnippet ?? entry.content ?? '').trim(),
    authors,
    categories: cats,
    published: entry.isoDate ?? entry.published ?? entry.pubDate ?? null,
  };
}

async function fetchOne(category, url) {
  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? []).map((entry) => ({
      ...parseArxivEntry(entry),
      source_category: category,
    }));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: e.message };
  }
}

export async function fetchArxiv() {
  const results = await Promise.all(
    ARXIV_FEEDS.map(({ category, url }) => fetchOne(category, url)),
  );
  const allItems = results.flatMap((r) => r.items);
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, items: allItems, per_feed: results };
}

runAsStandalone(import.meta.url, fetchArxiv);
