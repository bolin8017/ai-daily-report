// Section-aware feed condensation (Plan X retention strategy; Plan 2
// implementation). Pure: operates on raw feed items (which still carry
// published/score/stars/_scope before the legacy condense drops them). One
// slice per feed section. Retention-first: keep the full in-window pool and
// only trim once it exceeds the hard ceiling — there is intentionally NO
// soft-target truncation inside the engine.
import { estimateTokens } from './condense.js';

export const FEED_SECTIONS = ['pulse', 'market', 'tech'];

// SOFT_TARGET is NOT enforced here (the engine retains up to HARD_CEILING). It
// is exported as the curator's per-section prompt-budget target for the Plan 5
// cutover; the engine only trims above HARD_CEILING.
export const SOFT_TARGET = 30_000;
const HARD_CEILING = 50_000; // internal trim guard; override via opts.hardCeiling
const DESC_MAX = 200;

// Recency window (days). Stale items are dropped (not ranked) before retention.
// Per-source overrides for low-frequency venues; undated items are always kept.
// Tunable: candidate for extraction to sources.yaml / interests.yaml later.
const WINDOW_DEFAULT_DAYS = 4;
const WINDOW_OVERRIDES = {
  lwn: 10,
  nstc: 14,
  'gary-marcus': 7,
  'simon-willison': 7,
  'lilian-weng': 14,
  'sebastian-raschka': 14,
  'eugene-yan': 14,
  'hamel-husain': 14,
};

const MS_PER_DAY = 86_400_000;

export function ageInDays(published, dateString) {
  if (!published) return null;
  const pub = Date.parse(published);
  const now = Date.parse(`${dateString}T00:00:00Z`);
  if (Number.isNaN(pub) || Number.isNaN(now)) return null;
  return (now - pub) / MS_PER_DAY;
}

export function signalOf(item) {
  if (typeof item.score === 'number') return item.score;
  if (typeof item.stars === 'number') return item.stars;
  return null;
}

function maxAgeFor(sourceId) {
  return WINDOW_OVERRIDES[sourceId] ?? WINDOW_DEFAULT_DAYS;
}

function windowKeep(item, dateString) {
  const age = ageInDays(item.published, dateString);
  if (age === null) return true;
  return age <= maxAgeFor(item.source);
}

export function dedupeByUrl(items) {
  const best = new Map();
  for (const it of items) {
    const key = (it.url || '')
      .replace(/[#?].*$/, '')
      .replace(/\/$/, '')
      .toLowerCase();
    if (!key) {
      best.set(Symbol('urlless'), it);
      continue;
    }
    const prev = best.get(key);
    if (!prev || (signalOf(it) ?? -1) > (signalOf(prev) ?? -1)) best.set(key, it);
  }
  return [...best.values()];
}

const KEEP_FIELDS = new Set([
  'source',
  'title',
  'url',
  'score',
  'stars',
  'num_comments',
  'published',
  '_scope',
  'rank',
]);

function projectSliceItem(item, descMax) {
  const o = {};
  for (const [k, v] of Object.entries(item)) {
    if (!KEEP_FIELDS.has(k)) continue;
    if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) continue;
    o[k] = v;
  }
  const desc = item.description ?? item.desc ?? '';
  if (desc) o.desc = desc.length > descMax ? `${desc.slice(0, descMax)}...` : desc;
  return o;
}

// Trim ONLY above the hard ceiling. Each round: pick the largest source, drop
// its worst item (scored: lowest signal; score-less: oldest). Never a global
// score sweep; never empties the slice while >1 item remains.
function trimToCeiling(items, hardCeiling) {
  const live = [...items];
  const tokens = () => estimateTokens(JSON.stringify({ ok: true, items: live }));
  let guard = live.length + 1;
  while (tokens() > hardCeiling && live.length > 1 && guard-- > 0) {
    const bySource = new Map();
    for (const it of live) {
      const arr = bySource.get(it.source) ?? [];
      arr.push(it);
      bySource.set(it.source, arr);
    }
    let victimSource = null;
    let victimSize = -1;
    let victimTopSignal = Number.POSITIVE_INFINITY;
    for (const [src, arr] of bySource) {
      const topSignal = Math.max(...arr.map((i) => signalOf(i) ?? -1));
      if (arr.length > victimSize || (arr.length === victimSize && topSignal < victimTopSignal)) {
        victimSize = arr.length;
        victimTopSignal = topSignal;
        victimSource = src;
      }
    }
    const arr = bySource.get(victimSource);
    const scored = arr.some((i) => signalOf(i) !== null);
    arr.sort((a, b) => {
      if (scored) return (signalOf(a) ?? -1) - (signalOf(b) ?? -1); // lowest signal first
      const pa = Date.parse(a.published ?? '') || 0;
      const pb = Date.parse(b.published ?? '') || 0;
      return pa - pb; // oldest first
    });
    const victim = arr[0];
    const idx = live.indexOf(victim);
    if (idx < 0) break;
    live.splice(idx, 1);
  }
  return live;
}

export function buildSectionFeedSlices(feedItems, opts) {
  const { sectionMap, date, hardCeiling = HARD_CEILING, descMax = DESC_MAX } = opts;
  const slices = {};
  for (const section of FEED_SECTIONS) {
    const srcIds = new Set(sectionMap.sourcesForSection(section));
    const present = new Set();
    const raw = [];
    for (const it of feedItems) {
      if (!srcIds.has(it.source)) continue;
      present.add(it.source);
      raw.push(it);
    }
    const windowed = raw.filter((it) => windowKeep(it, date));
    const hygienic = windowed.filter((it) => it.url || it.title);
    const deduped = dedupeByUrl(hygienic);
    let projected = deduped.map((it) => projectSliceItem(it, descMax));
    if (estimateTokens(JSON.stringify({ ok: true, items: projected })) > hardCeiling) {
      projected = trimToCeiling(projected, hardCeiling);
    }
    const degraded = [...srcIds].filter((id) => !present.has(id));
    slices[section] = { ok: projected.length > 0, items: projected, degraded };
  }
  return slices;
}

// Package the already-condensed github inputs (condenseAll outputs — stars-
// ranked + LENS_QUOTA-reserved) into one shipped slice. shipped is github-only
// (no feed/Plan-X treatment); artifact-level unification so all four sections
// emit a feeds-<section>.json. The shipped curator reads this at the Plan 5
// cutover instead of three separate files.
export function buildShippedSlice(condensed) {
  const trending = condensed?.trending?.items ?? [];
  const search = condensed?.search?.items ?? [];
  const developers = condensed?.developers?.items ?? [];
  const ok = trending.length > 0 || search.length > 0 || developers.length > 0;
  return { ok, trending, search, developers };
}
