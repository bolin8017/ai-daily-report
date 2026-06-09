#!/usr/bin/env node
// Stage 1: Data collection pipeline.
//
// Fetches all sources in parallel, condenses each to ≤8500 tokens,
// builds the feeds snapshot for 11ty, and writes everything to
// data/staging/ for Stage 2 (agent analysis).
//
// Pure Node.js — no LLM dependency.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
// Side-effect imports — populate the provider registry for runAll
import './fetchers/providers/arxiv-rss.js';
import './fetchers/providers/firecrawl.js';
import './fetchers/providers/github-catalog.js';
import './fetchers/providers/github-developers-api.js';
import './fetchers/providers/github-developers-html.js';
import './fetchers/providers/github-search-api.js';
import './fetchers/providers/github-trending-html.js';
import './fetchers/providers/hf-trending-json.js';
import './fetchers/providers/hn-firebase.js';
import './fetchers/providers/jina-reader.js';
import './fetchers/providers/leaderboard-html.js';
import './fetchers/providers/lobsters-json.js';
import './fetchers/providers/mops-twse-openapi.js';
import './fetchers/providers/native-json.js';
import './fetchers/providers/native-rss.js';
import './fetchers/providers/rsshub.js';

import { fetchMinifluxEntries } from './fetchers/miniflux.js';
import { runAll } from './fetchers/run-all.js';
import { condenseAll } from './lib/condense.js';
import { ACTIVE_THEME } from './lib/config.js';
import { loadFeedList } from './lib/feeds-opml.js';
import { minifluxConfigured } from './lib/miniflux-client.js';
import { tagItemScope } from './lib/scope.js';
import {
  buildSectionFeedSlices,
  buildShippedSlice,
  FEED_SECTIONS,
} from './lib/section-condense.js';
import { loadSectionMap } from './lib/section-map.js';
import { buildSnapshot } from './lib/snapshot.js';
import { buildSourceDateMap, computeAges } from './lib/source-dates.js';
import { resolveEffectiveSources } from './lib/sources.js';
import { getCachedTheme } from './lib/theme.js';
import { StagingMetadataSchema } from './schemas/staging.js';

// Feed-type sources are exactly the RSS/Atom + Hacker News chains; everything
// else (github-*, hf-trending, mops, arxiv, leaderboard-*) is a structured
// fetcher mapped to its own bucket below. Derive the set from the resolved
// source registry by itemType rather than maintaining a parallel hardcoded
// list — a hardcoded list silently dropped every theme-overlay feed (phison-blog,
// sk-hynix-news) and any newly-added source that wasn't also added here.
const FEED_ITEM_TYPES = new Set(['rss-post', 'hn-story']);

// Map per-source chain results into the legacy `{feeds, trending, search,
// developers, leaderboards, mops, hf_trending, arxiv}` shape so downstream
// condense / snapshot / scope logic keeps working without per-source rewrite.
function mapResultsToLegacyShape(results, sources) {
  const feedIds = new Set(sources.filter((s) => FEED_ITEM_TYPES.has(s.itemType)).map((s) => s.id));
  const out = {};
  out.feeds = {
    ok: true,
    items: Object.entries(results)
      .filter(([id]) => feedIds.has(id))
      .flatMap(([, r]) => r.items ?? []),
  };
  out.trending = results['github-trending'] ?? { ok: false, items: [] };
  out.search = results['github-search-topics'] ?? { ok: false, items: [] };
  out.developers = results['github-developers'] ?? { ok: false, items: [] };
  out.catalog = results['github-catalog'] ?? { ok: false, items: [] };
  out.hf_trending = results['hf-trending'] ?? { ok: false, items: [] };
  out.mops = results['mops-disclosure'] ?? { ok: false, items: [] };
  out.arxiv = results['arxiv-cs-ai'] ?? { ok: false, items: [] };
  out.leaderboards = {
    ok: true,
    items: ['bfcl', 'mteb', 'swebench', 'ocrbench', 'pinchbench']
      .map((name) => results[`leaderboard-${name}`])
      .filter((r) => r?.ok)
      .flatMap((r) => r.items ?? []),
  };
  return out;
}

const TZ = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
const SKIP_PUSH = process.env.SKIP_PUSH === '1' || process.argv.includes('--skip-push');

const RUN_ID = randomUUID();
const PIPELINE_VERSION = pipelineVersion();

function todayIn(tz) {
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

// execFileSync (args array, no shell) instead of execSync (shell string).
// No user input flows here, but defense-in-depth is cheap.
function pipelineVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function banner(msg) {
  console.error(`\n[collect ${RUN_ID.slice(0, 8)}] ${new Date().toISOString()} — ${msg}`);
}

async function main() {
  const date = todayIn(TZ);
  banner(`start ${date} (${TZ}) run_id=${RUN_ID} version=${PIPELINE_VERSION}`);

  // Phase 1 — fetch all sources through their provider chains in parallel.
  // Each source has its own ordered chain (e.g. RSSHub → HN Firebase → Jina →
  // Firecrawl for HN), so one tool failure doesn't lose the content.
  banner('fetching sources');
  // Miniflux owns the native-RSS feeds listed in feeds.opml; the chain fetches
  // everything else (HN/Lobsters, RSSHub-only dev-to/anthropic, slow sk-hynix,
  // and all structured sources). If Miniflux isn't configured (e.g. local dev
  // without the stack), fall back to chain-fetching everything so the pipeline
  // still runs.
  const minifluxOn = minifluxConfigured();
  const minifluxIds = minifluxOn ? new Set(loadFeedList().map((f) => f.id)) : new Set();
  const allSources = await resolveEffectiveSources();
  const sources = allSources.filter((s) => !minifluxIds.has(s.id));
  const { results, degraded } = await runAll(sources, {
    date,
    minHealthy: Math.ceil(sources.length / 3),
  });
  const raw = mapResultsToLegacyShape(results, sources);
  if (degraded.length) raw._degraded = degraded;

  // Pull the native-RSS feed half from Miniflux and merge into the feeds bucket.
  // No chain fallback for these by design (graceful degrade): if Miniflux is down
  // the feed half is thinner that day, but HN/Lobsters/shipped/structured still
  // produce a report (runAll's minHealthy already tolerates degraded sources).
  if (minifluxOn) {
    const mf = await fetchMinifluxEntries();
    if (mf.ok) {
      raw.feeds.items = [...mf.items, ...(raw.feeds.items ?? [])];
      raw.feeds.ok = raw.feeds.items.length > 0;
      banner(`miniflux: +${mf.items.length} native-RSS feed items`);
    } else {
      banner(`miniflux feed pull FAILED (feed half degraded): ${mf.error}`);
      raw._degraded ??= [];
      raw._degraded.push('miniflux-feeds');
    }
  }

  // Phase 2 — build feeds snapshot (committed to data/feeds-snapshot.json for 11ty)
  banner('building snapshot');
  buildSnapshot(raw.feeds);

  // Phase 3 — tag scope on RAW items BEFORE condense.
  // Items from global sources get ["global"]; items also matching the theme's
  // phison_overlay (specific source ids or GitHub topics) get
  // ["global", "<theme-name>"]. Tagging here (rather than post-condense) lets
  // condense reserve quota for theme-tagged items so low-star overlay signals
  // (e.g. niche github topics like kv-cache) aren't crowded out by popular
  // global items.
  // Only tag the 4 "core" fetchers — new IA-redesign fetchers (leaderboards,
  // mops, hf_trending, arxiv) bypass condense entirely (written raw to staging).
  const theme = await getCachedTheme(ACTIVE_THEME);
  for (const fetcherKey of ['feeds', 'trending', 'search', 'developers']) {
    if (raw[fetcherKey] && Array.isArray(raw[fetcherKey].items)) {
      raw[fetcherKey].items = raw[fetcherKey].items.map((item) => tagItemScope(item, theme));
    }
  }

  // Phase 4 — condense per-source for prompt-size control (scope-aware)
  banner('condensing');
  const condensed = condenseAll(raw);

  // Phase 4b — section-aware feed slices (sole feed staging after Plan 5 cutover).
  // Built from RAW feed items, which still carry published/score/_scope.
  const sectionMap = await loadSectionMap();
  const sectionSlices = buildSectionFeedSlices(raw.feeds.items, { sectionMap, date });
  const shippedSlice = buildShippedSlice(condensed);

  // Phase 5 — write staging files for Stage 2 (agent analysis)
  banner('writing staging data');
  mkdirSync('data/staging', { recursive: true });

  // source-dates → source-ages (today − published) is derived here in Stage 1 so the
  // synthesize stage no longer has to; computeAges is pure (see lib/source-dates.js).
  const sourceDates = buildSourceDateMap({ feeds: raw.feeds, arxiv: raw.arxiv });

  // New IA-redesign fetchers are written raw (no condense step) since their
  // payloads are small + structured (leaderboards: 5 snapshots; mops: tracked
  // tickers only; hf_trending: capped to 15; arxiv: topic-locked (≤30 on-theme)).
  const files = {
    'data/staging/leaderboards.json': raw.leaderboards ?? { ok: false, items: [] },
    'data/staging/mops.json': raw.mops ?? { ok: false, items: [] },
    'data/staging/hf_trending.json': {
      ...(raw.hf_trending ?? { ok: false, items: [] }),
      items: (raw.hf_trending?.items ?? []).slice(0, 15),
    },
    'data/staging/arxiv.json': raw.arxiv ?? { ok: false, items: [] },
    // Section slices are the sole feed staging (Plan 5 cutover — unified.json
    // and the per-GitHub condensed files are no longer written).
    'data/staging/feeds-pulse.json': sectionSlices.pulse,
    'data/staging/feeds-market.json': sectionSlices.market,
    'data/staging/feeds-tech.json': sectionSlices.tech,
    'data/staging/feeds-shipped.json': shippedSlice,
    'data/staging/feeds-catalog.json': raw.catalog ?? { ok: false, items: [] },
    // url→published map for the Stage 3.5 faithfulness guard. Built from raw
    // FEED items (GitHub excluded — repo dates ≠ "appeared today"). Captured
    // here because condense drops date fields before the curator/guard see them.
    'data/staging/source-dates.json': sourceDates,
    'data/staging/source-ages.json': computeAges(sourceDates, date),
    'data/staging/metadata.json': {
      date,
      run_id: RUN_ID,
      pipeline_version: PIPELINE_VERSION,
      collected_at: new Date().toISOString(),
      timezone: TZ,
      sources: {
        feeds: { ok: raw.feeds.ok, count: raw.feeds.items?.length ?? 0 },
        trending: { ok: raw.trending.ok, count: raw.trending.items?.length ?? 0 },
        search: { ok: raw.search.ok, count: raw.search.items?.length ?? 0 },
        developers: { ok: raw.developers.ok, count: raw.developers.items?.length ?? 0 },
        catalog: { ok: raw.catalog?.ok ?? false, count: raw.catalog?.items?.length ?? 0 },
        leaderboards: {
          ok: raw.leaderboards?.ok ?? false,
          count: raw.leaderboards?.items?.length ?? 0,
        },
        mops: { ok: raw.mops?.ok ?? false, count: raw.mops?.items?.length ?? 0 },
        hf_trending: {
          ok: raw.hf_trending?.ok ?? false,
          count: raw.hf_trending?.items?.length ?? 0,
        },
        arxiv: { ok: raw.arxiv?.ok ?? false, count: raw.arxiv?.items?.length ?? 0 },
      },
      // Per-section feed item counts — observability for the section-slice
      // engine. A sibling of `sources` (NOT a member): every `sources` entry is
      // a {ok,count} health record, and Stage 4 copies that whole object into
      // report meta.source_health, which the report schema types as a uniform
      // {ok,count} map. Keeping this section→count breakdown out of `sources`
      // preserves that invariant.
      feeds_sections: {
        ...Object.fromEntries(FEED_SECTIONS.map((s) => [s, sectionSlices[s].items.length])),
        shipped:
          shippedSlice.trending.length +
          shippedSlice.search.length +
          shippedSlice.developers.length,
      },
      degraded: raw._degraded ?? [],
    },
  };

  // Validate metadata against schema before writing (contract with Stage 2)
  StagingMetadataSchema.parse(files['data/staging/metadata.json']);

  for (const [path, data] of Object.entries(files)) {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    console.error(`  ✓ ${path}`);
  }

  // Phase 6 — staging + feeds-snapshot are ephemeral collect outputs.
  // The data branch stays trimmed to public artifacts: reports plus the
  // feeds snapshot that 11ty needs. Stage 4 / run.sh commits those once
  // synthesis succeeds; cross-day intelligence lives in Hermes Wiki, not here.
  if (SKIP_PUSH) {
    banner('SKIP_PUSH — stopping before exit');
    return;
  }
  banner('staging data is volume-only — nothing to commit at collect stage');
}

main().catch((err) => {
  // Format ZodError issues for readable log output
  if (err.issues) {
    console.error('[collect] FATAL: schema validation failed:');
    for (const issue of err.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  } else {
    console.error(`[collect] FATAL: ${err.stack ?? err.message ?? String(err)}`);
  }
  process.exit(1);
});
