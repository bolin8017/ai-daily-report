#!/usr/bin/env node
// Condense raw fetcher results into compact versions that stay under a strict
// token budget. Used primarily in-memory by src/collect.js; the standalone
// mode (reads tmp/*.json, writes tmp/*-condensed.json) is kept for debugging.
//
// Strategy:
//   1. Drop noisy fields per item (readme_excerpt, comments, author, etc.)
//   2. For unified-feeds: group by source, cap each source, sort by score
//   3. For others: cap total items, sort by stars/importance
//   4. Truncate descriptions to a target length
//   5. Progressive fallback: if output still > budget, tighten caps
//   6. Hard check: throw if budget still exceeded after all attempts
//
// The token-per-char ratio is measured empirically at ~1.8 for this content
// (dense JSON with structural chars + mixed CJK/English). We use 1.7 as a
// conservative estimator.

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUDGET_TOKENS = 8500;
const CHARS_PER_TOKEN = 1.7;
const estimateTokens = (s) => Math.ceil(s.length / CHARS_PER_TOKEN);

// Fields dropped from every item in condensed output.
const DROP = new Set([
  'readme_excerpt',
  'comments',
  'full_text',
  'discussion_url',
  'isoDate',
  'contentSnippet',
  'content',
  'guid',
  'link',
  'creator',
  'categories',
  'hn_id',
  'author',
  'published',
  'created_at',
  'updated_at',
  'pushed_at',
  'subscribers_count',
  'forks',
  'watchers',
  'open_issues',
  'license',
  'default_branch',
  'has_wiki',
  'has_pages',
]);

function condenseItem(item, descMax) {
  const o = {};
  for (const [k, v] of Object.entries(item)) {
    if (DROP.has(k)) continue;
    if ((k === 'description' || k === 'desc') && typeof v === 'string' && v.length > descMax) {
      o[k] = `${v.slice(0, descMax)}...`;
      continue;
    }
    if (v === '' || (Array.isArray(v) && v.length === 0)) continue;
    o[k] = v;
  }
  return o;
}

function sortByImportance(a, b) {
  const sa = a.score ?? a.stars ?? 0;
  const sb = b.score ?? b.stars ?? 0;
  if (sa !== sb) return sb - sa;
  return (a.rank || 9999) - (b.rank || 9999);
}

function condenseUnifiedFeeds(data, caps, descMax) {
  const groups = {};
  for (const item of data.items || []) {
    const s = item.source || 'other';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  }
  const items = [];
  for (const [source, group] of Object.entries(groups)) {
    group.sort(sortByImportance);
    const cap = caps[source] ?? caps._default;
    items.push(...group.slice(0, cap).map((it) => condenseItem(it, descMax)));
  }
  return { ...data, items };
}

function condenseFlat(data, cap, descMax) {
  const items = (data.items || [])
    .slice()
    .sort(sortByImportance)
    .slice(0, cap)
    .map((it) => condenseItem(it, descMax));
  return { ...data, items };
}

const ATTEMPTS = [
  {
    unified: { hackernews: 20, Lobsters: 12, 'Dev.to Top': 10, _default: 5 },
    flat: { trending: 12, search: 25, developers: 20 },
    descMax: 120,
  },
  {
    unified: { hackernews: 15, Lobsters: 10, 'Dev.to Top': 8, _default: 4 },
    flat: { trending: 12, search: 20, developers: 15 },
    descMax: 100,
  },
  {
    unified: { hackernews: 12, Lobsters: 8, 'Dev.to Top': 6, _default: 3 },
    flat: { trending: 10, search: 15, developers: 12 },
    descMax: 80,
  },
  {
    unified: { hackernews: 10, Lobsters: 6, 'Dev.to Top': 5, _default: 3 },
    flat: { trending: 10, search: 12, developers: 10 },
    descMax: 60,
  },
  {
    unified: { hackernews: 8, Lobsters: 5, 'Dev.to Top': 4, _default: 2 },
    flat: { trending: 8, search: 10, developers: 8 },
    descMax: 40,
  },
];

function condenseOne(data, type) {
  for (const a of ATTEMPTS) {
    let result;
    if (type === 'unified-feeds') {
      result = condenseUnifiedFeeds(data, a.unified, a.descMax);
    } else if (type === 'github-trending') {
      result = condenseFlat(data, a.flat.trending, a.descMax);
    } else if (type === 'github-search') {
      result = condenseFlat(data, a.flat.search, a.descMax);
    } else if (type === 'github-developers') {
      result = condenseFlat(data, a.flat.developers, a.descMax);
    } else {
      throw new Error(`[condense] unknown type: ${type}`);
    }
    const tokens = estimateTokens(JSON.stringify(result));
    if (tokens <= BUDGET_TOKENS) return { result, tokens };
  }
  // All attempts exhausted
  const final = ATTEMPTS[ATTEMPTS.length - 1];
  let result;
  if (type === 'unified-feeds') {
    result = condenseUnifiedFeeds(data, final.unified, final.descMax);
  } else {
    const key = type.replace('github-', '');
    result = condenseFlat(data, final.flat[key] ?? 8, final.descMax);
  }
  const tokens = estimateTokens(JSON.stringify(result));
  return { result, tokens, exhausted: true };
}

/**
 * Condense raw fetcher results in-memory.
 * @param {object} raw - { feeds, trending, search, developers } from runFetchers()
 * @returns {object} { unified, trending, search, developers } — condensed objects
 * @throws if any condensed output exceeds BUDGET_TOKENS after all attempts
 */
export function condenseAll(raw) {
  const plan = [
    { type: 'unified-feeds', input: raw.feeds, key: 'unified' },
    { type: 'github-trending', input: raw.trending, key: 'trending' },
    { type: 'github-search', input: raw.search, key: 'search' },
    { type: 'github-developers', input: raw.developers, key: 'developers' },
  ];

  const out = {};
  const over = [];
  for (const { type, input, key } of plan) {
    const { result, tokens, exhausted } = condenseOne(input, type);
    out[key] = result;
    if (exhausted) over.push(`${type} (${tokens} tokens)`);
  }
  if (over.length > 0) {
    throw new Error(`[condense] budget exceeded: ${over.join(', ')}`);
  }
  return out;
}

// --- Standalone mode (file in, file out) — kept for debugging ---

const STANDALONE_FILES = [
  { in: 'tmp/unified-feeds.json', out: 'tmp/unified-feeds-condensed.json', type: 'unified-feeds' },
  {
    in: 'tmp/github-trending.json',
    out: 'tmp/github-trending-condensed.json',
    type: 'github-trending',
  },
  { in: 'tmp/github-search.json', out: 'tmp/github-search-condensed.json', type: 'github-search' },
  {
    in: 'tmp/github-developers.json',
    out: 'tmp/github-developers-condensed.json',
    type: 'github-developers',
  },
];

function runStandalone() {
  let overBudget = 0;
  for (const f of STANDALONE_FILES) {
    if (!existsSync(f.in)) {
      console.error(`[condense] ${f.in} not found, skipping`);
      continue;
    }
    const data = JSON.parse(readFileSync(f.in, 'utf8'));
    const { result, tokens, exhausted } = condenseOne(data, f.type);
    writeFileSync(f.out, JSON.stringify(result));
    const mark = tokens <= BUDGET_TOKENS ? '✓' : '✗';
    const note = exhausted ? ' [BUDGET EXCEEDED]' : '';
    console.error(`${mark} ${f.out}: ${result.items?.length ?? 0} items, ~${tokens} tokens${note}`);
    if (tokens > BUDGET_TOKENS) overBudget++;
  }
  if (overBudget > 0) {
    console.error(`[condense] FATAL: ${overBudget} file(s) exceed budget ${BUDGET_TOKENS}`);
    process.exit(1);
  }
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) runStandalone();
