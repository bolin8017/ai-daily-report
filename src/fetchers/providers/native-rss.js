import RSSParser from 'rss-parser';
import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;

function coerceAuthor(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(coerceAuthor).filter(Boolean).join(', ');
  if (typeof raw === 'object') {
    const name = raw.name ?? raw.author ?? raw.displayName;
    if (Array.isArray(name)) return name[0] ?? '';
    if (typeof name === 'string') return name;
  }
  return '';
}

function coerceCategories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c : (c?._ ?? c?.name ?? c?.term ?? '')))
    .filter(Boolean);
}

function stripHTML(html) {
  return (html ?? '').replace(/<[^>]*>/g, '').trim();
}

export async function nativeRSSProvider(cfg, ctx) {
  const res = await fetch(cfg.url, {
    signal: AbortSignal.timeout(TIMEOUT),
    // Some hosts (Reddit) serve a feed only to a browser UA and 403 everything
    // else, so a source may override the default.
    headers: { 'User-Agent': cfg.userAgent ?? 'ai-daily-report/1.0' },
  });
  if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
  const xml = await res.text();
  const feed = await new RSSParser().parseString(xml);
  const rawItems = (feed.items ?? []).slice(0, cfg.limit ?? 20);
  const items = rawItems.map((item, i) => ({
    source: cfg.sourceName ?? ctx.sourceId,
    category: cfg.category,
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.link === 'string' ? item.link : '',
    description: (item.contentSnippet ?? stripHTML(item.content) ?? '').slice(0, 500),
    author: coerceAuthor(item.creator ?? item.author ?? item['dc:creator']),
    published: item.isoDate ?? item.pubDate ?? null,
    tags: coerceCategories(item.categories),
    rank: i + 1,
  }));
  return { ok: true, items };
}

defineProvider('native-rss', nativeRSSProvider);
