import { getThemeSources } from '../../lib/theme.js';
import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;

async function defaultUrls() {
  if (process.env.RSSHUB_URL) return [process.env.RSSHUB_URL];
  const sources = await getThemeSources();
  return sources.rsshub_urls ?? ['https://rsshub.pseudoyu.com'];
}

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
  const escaped = linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html?.match(new RegExp(`<a[^>]+?href="([^"]+)"[^>]*?>[^<]*?${escaped}`, 'i'));
  return m?.[1] || null;
}

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

function normalizeArxivPaper(item, _sourceName, _category, _rank) {
  // For HuggingFace daily papers: extract paper_id from URL
  // URL format: https://huggingface.co/papers/YYMM.NNNNN
  const paperIdMatch = item.url?.match(/\/papers\/([0-9]{4}\.[0-9]+)/);
  const paperId = paperIdMatch?.[1] || null;

  // Authors may be in item.authors (array) or item.author (string)
  let authors = [];
  if (Array.isArray(item.authors)) {
    authors = item.authors.map((a) => a.name || a).filter(Boolean);
  } else if (typeof item.author === 'string') {
    // Parse comma-separated author string
    authors = item.author.split(/,\s*/).filter(Boolean);
  }

  return {
    paper_id: paperId,
    url: paperId ? `https://arxiv.org/abs/${paperId}` : item.url || '',
    title: item.title || '',
    abstract: item.content_text || stripHTML(item.content_html) || item.description || '',
    authors,
    categories: ['cs.LG'], // Default category for HuggingFace daily papers
    published: item.date_published || null,
  };
}

function normalizeGeneric(item, sourceName, category, rank) {
  return {
    source: sourceName,
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

export async function rsshubProvider(cfg, ctx) {
  const urls = (cfg.urls ?? (await defaultUrls())).map((u) => u.replace(/\/$/, ''));
  const suffix = `${cfg.route}?format=json&limit=${cfg.limit ?? 30}`;

  let lastError;
  for (let i = 0; i < urls.length; i++) {
    const fullUrl = `${urls[i]}${suffix}`;
    try {
      const res = await fetch(fullUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': 'ai-daily-report/1.0' },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, items: [], error: `HTTP ${res.status} (route error)` };
        }
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const feed = await res.json();
      const raw = feed.items ?? [];
      let items;
      if (cfg.normalize === 'hackernews') {
        items = raw.map((r, idx) => normalizeHN(r, idx + 1));
      } else if (ctx.itemType === 'arxiv-paper') {
        // HuggingFace daily papers: normalize to arxiv-paper shape
        items = raw.map((r, idx) =>
          normalizeArxivPaper(r, cfg.sourceName ?? ctx.sourceId, cfg.category, idx + 1),
        );
      } else {
        items = raw.map((r, idx) =>
          normalizeGeneric(r, cfg.sourceName ?? ctx.sourceId, cfg.category, idx + 1),
        );
      }
      return { ok: true, items, meta: { url: urls[i] } };
    } catch (err) {
      lastError = err.message;
    }
  }
  return { ok: false, items: [], error: `all rsshub urls failed: ${lastError}` };
}

defineProvider('rsshub', rsshubProvider);
