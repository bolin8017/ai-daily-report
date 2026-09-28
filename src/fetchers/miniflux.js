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

// Feed health. Miniflux stops scheduling a feed once parsing_error_count hits
// POLLING_PARSING_ERROR_LIMIT, and the entries pull above cannot tell a quiet
// feed from a dead one: after the 2026-09-10 DNS outage 43 feeds froze and the
// pull shrank from ~4,600 entries to 25 over 18 days while collect reported ok.
// So ask Miniflux about each in-scope feed directly. Polling is hourly, so one
// failed poll is noise that clears itself; two in a row is a trend. Staleness
// allows the scheduler's 24h max interval plus slack.
const FEED_ERROR_MIN = 2;
const FEED_STALE_HOURS = 26;
const FEED_NOTE_MAX = 5;

// feeds: Miniflux /v1/feeds[]; knownSources: Set of in-scope source ids.
// Returns one record per unhealthy in-scope feed. `missing` is a feeds.opml id
// Miniflux does not carry at all (sync never ran, or the feed was deleted).
export function assessFeedHealth(feeds, knownSources, now = Date.now()) {
  const unhealthy = [];
  const seen = new Set();
  for (const f of feeds) {
    const id = f.title;
    if (!id || !knownSources.has(id)) continue;
    seen.add(id);
    const errors = f.parsing_error_count ?? 0;
    const checked = Date.parse(f.checked_at ?? '');
    const stale = !(checked > now - FEED_STALE_HOURS * 3_600_000);
    let reason = null;
    if (f.disabled) reason = 'disabled';
    else if (stale) reason = 'stalled';
    else if (errors >= FEED_ERROR_MIN) reason = 'erroring';
    if (!reason) continue;
    unhealthy.push({
      id,
      reason,
      errors,
      checked_at: f.checked_at ?? null,
      message: (f.parsing_error_message ?? '').slice(0, 120),
    });
  }
  for (const id of knownSources) {
    if (!seen.has(id)) {
      unhealthy.push({ id, reason: 'missing', errors: 0, checked_at: null, message: '' });
    }
  }
  return { total: knownSources.size, unhealthy };
}

// One bounded degraded note for the production notice, or null when healthy.
export function feedHealthNote({ total, unhealthy }) {
  if (!unhealthy?.length) return null;
  const named = unhealthy.slice(0, FEED_NOTE_MAX).map((u) => `${u.id} ${u.reason}`);
  const more = unhealthy.length - named.length;
  if (more > 0) named.push(`+${more} more`);
  return `miniflux-feeds (${unhealthy.length}/${total} unhealthy: ${named.join(', ')})`;
}

// Fail-soft: a failed /v1/feeds call returns { ok: false, error }, never throws.
export async function fetchMinifluxFeedHealth(opts = {}) {
  const baseUrl = opts.baseUrl ?? minifluxBaseUrl();
  const auth = opts.authHeaders ?? minifluxAuthHeaders();
  if (!baseUrl || !auth) return { ok: false, error: 'Miniflux not configured' };
  const knownSources =
    opts.knownSources ?? new Set((opts.feeds ?? loadFeedList()).map((f) => f.id));
  try {
    const res = await fetch(`${baseUrl}/v1/feeds`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { ...auth },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const feeds = await res.json();
    if (!Array.isArray(feeds)) return { ok: false, error: 'unexpected /v1/feeds payload' };
    return { ok: true, ...assessFeedHealth(feeds, knownSources, opts.now) };
  } catch (err) {
    return { ok: false, error: err.message };
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
  const run = process.argv.includes('--health') ? fetchMinifluxFeedHealth : fetchMinifluxEntries;
  run().then((r) => {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  });
}
