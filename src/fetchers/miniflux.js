// Pulls feed items from self-hosted Miniflux for Stage 1. Replaces the per-source
// native-RSS provider chains: Miniflux polls every feed 24/7, so one windowed
// pull returns a full, deduped set regardless of fetch-time hiccups.
//
// Each entry is mapped to its registry source id via feed.title, which the sync
// (scripts/miniflux-sync.mjs) set = source id. This is redirect-proof: Miniflux
// rewrites feed_url when a feed redirects, but the title we assigned is stable.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFeedList } from '../lib/feeds-opml.js';
import { minifluxAuthHeaders, minifluxBaseUrl } from '../lib/miniflux-client.js';

const TIMEOUT = 30_000;
// Coarse upper bound on how far back to pull. Must be >= section-condense's
// widest per-source recency window (14 days) so it never pre-starves a long-
// window source (e.g. lilian-weng/eugene-yan at 14d); the precise per-source
// windowing happens downstream in section-condense, not here.
const DEFAULT_WINDOW_HOURS = 16 * 24; // 16 days
const DESC_MAX = 500;
const PAGE = 100;

const stripHtml = (s) =>
  (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// entries: Miniflux /v1/entries[]; knownSources: Set of valid registry ids.
// Items are score-less by design — Plan X ranks score-less sources by recency
// window, and section routing keys on `source`. `_scope` is added later by
// collect.js (tagItemScope), never here.
export function normalizeEntries(entries, knownSources) {
  const items = [];
  for (const e of entries) {
    const source = e.feed?.title;
    if (!source || !knownSources.has(source)) continue;
    items.push({
      source,
      title: e.title ?? '',
      url: e.url ?? '',
      description: stripHtml(e.content).slice(0, DESC_MAX),
      author: e.author ?? '',
      published: e.published_at ?? e.created_at ?? null,
      rank: items.length + 1,
    });
  }
  return items;
}

export async function fetchMinifluxEntries(opts = {}) {
  const baseUrl = opts.baseUrl ?? minifluxBaseUrl();
  const auth = opts.authHeaders ?? minifluxAuthHeaders();
  if (!baseUrl || !auth) {
    return {
      ok: false,
      items: [],
      error: 'Miniflux not configured (MINIFLUX_URL + token/basic auth)',
    };
  }
  const knownSources =
    opts.knownSources ?? new Set((opts.feeds ?? loadFeedList()).map((f) => f.id));
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const after = opts.since ?? Math.floor((Date.now() - windowHours * 3_600_000) / 1000);

  try {
    const items = [];
    let offset = 0;
    for (;;) {
      const q = `published_after=${after}&direction=asc&order=published_at&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(`${baseUrl}/v1/entries?${q}`, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { ...auth },
      });
      if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
      const data = await res.json();
      const batch = data.entries ?? [];
      items.push(...normalizeEntries(batch, knownSources));
      offset += PAGE;
      if (batch.length < PAGE || offset >= (data.total ?? 0)) break;
    }
    items.forEach((it, i) => {
      it.rank = i + 1;
    });
    return { ok: true, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  fetchMinifluxEntries().then((r) => {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  });
}
