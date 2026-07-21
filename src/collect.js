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
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Side-effect imports — populate the provider registry for runAll
import './fetchers/providers/arxiv-rss.js';
import './fetchers/providers/firecrawl.js';
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
import { buildDiscoveries } from './lib/build-discoveries.js';
import { condenseAll } from './lib/condense.js';
import { ACTIVE_THEME } from './lib/config.js';
import { loadFeedList } from './lib/feeds-opml.js';
import { getContributors, getRecentCommits, getRepoTree, makeOctokit } from './lib/github.js';
import { minifluxConfigured } from './lib/miniflux-client.js';
import { fetchPackageDownloads } from './lib/registry-downloads.js';
import { tagItemScope } from './lib/scope.js';
import {
  buildSectionFeedSlices,
  buildShippedSlice,
  FEED_SECTIONS,
} from './lib/section-condense.js';
import { loadSectionMap } from './lib/section-map.js';
import { loadSeenSet } from './lib/seen-repos.js';
import { buildSnapshot } from './lib/snapshot.js';
import { buildSourceDateMap, computeAges } from './lib/source-dates.js';
import { resolveEffectiveSources } from './lib/sources.js';
import { loadStarHistory, recordSnapshot as recordStarSnapshot } from './lib/star-history.js';
import { getCachedTheme } from './lib/theme.js';
import { DiscoveriesStagingSchema } from './schemas/discoveries.js';
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
// Exported for tests; the isMain guard below keeps the import side-effect-free.
export function mapResultsToLegacyShape(results, sources) {
  const feedIds = new Set(sources.filter((s) => FEED_ITEM_TYPES.has(s.itemType)).map((s) => s.id));
  const out = {};
  const feedItems = Object.entries(results)
    .filter(([id]) => feedIds.has(id))
    .flatMap(([, r]) => r.items ?? []);
  // ok must be derived, not asserted: a hardcoded true survived into
  // metadata.sources.feeds → report.meta.source_health, rendering the feed
  // half green on a day it collected nothing (the Miniflux merge later
  // re-derives ok, but only when Miniflux is configured).
  out.feeds = { ok: feedItems.length > 0, items: feedItems };
  out.trending = results['github-trending'] ?? { ok: false, items: [] };
  out.search = results['github-search-topics'] ?? { ok: false, items: [] };
  out.developers = results['github-developers'] ?? { ok: false, items: [] };
  out.hf_trending = results['hf-trending'] ?? { ok: false, items: [] };
  out.mops = results['mops-disclosure'] ?? { ok: false, items: [] };
  out.arxiv = results['arxiv-cs-ai'] ?? { ok: false, items: [] };
  const leaderboardIds = sources.filter((s) => s.itemType === 'leaderboard-entry').map((s) => s.id);
  out.leaderboards = {
    ok: true,
    items: leaderboardIds
      .map((id) => results[id])
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

  // Phase 2b — append today's star/fork snapshot for every collected GitHub
  // repo to data/star-history.json (velocity backbone; committed by Stage 4).
  // Zero extra API: the numbers are already in the fetched payloads.
  banner('recording star snapshot');
  const githubItems = [
    ...(raw.trending.items ?? []),
    ...(raw.search.items ?? []),
    ...(raw.developers.items ?? []),
  ];
  const starSnap = recordStarSnapshot(githubItems, date);
  banner(
    starSnap.skipped
      ? 'star-history: SKIPPED — prior ledger unreadable, nothing overwritten'
      : `star-history: recorded ${starSnap.recorded} repos (${starSnap.repos} tracked)`,
  );

  // Phase 2c — run the excellence funnel over today's GitHub candidates and
  // write data/staging/feeds-discoveries.json (observable; not yet rendered —
  // Phase 3 consumes it). Tree fetches hit only velocity-gate survivors.
  banner('building discoveries candidate pool');
  try {
    const octokit = makeOctokit();
    const fetchTree = (item) => {
      const [owner, name] = (item.full_name ?? '').split('/');
      return owner && name
        ? getRepoTree(octokit, owner, name, item.default_branch, 'discoveries')
        : Promise.resolve([]);
    };
    // Behavioral-signal closures (Phase 4) — only the top survivors hit these,
    // so the extra ~2 GitHub-core calls/repo stay well inside the daily budget.
    // npm downloads is public HTTP (no GitHub quota), keyed on the repo name as
    // the package guess; all three are fail-soft.
    const fetchCommits = (item) => {
      const [owner, name] = (item.full_name ?? '').split('/');
      return owner && name
        ? getRecentCommits(octokit, owner, name, 30, 'discoveries')
        : Promise.resolve([]);
    };
    const fetchContributors = (item) => {
      const [owner, name] = (item.full_name ?? '').split('/');
      return owner && name
        ? getContributors(octokit, owner, name, 'discoveries')
        : Promise.resolve([]);
    };
    const fetchDownloads = (item) => {
      const [, name] = (item.full_name ?? '').split('/');
      return fetchPackageDownloads(name);
    };
    const discoveries = await buildDiscoveries({
      items: githubItems,
      history: loadStarHistory(),
      feedItems: raw.feeds.items ?? [],
      // shownBefore: a completed day's full re-run must not treat today's own
      // ledger entries as seen, or the regenerated 新發現 comes out empty.
      seen: loadSeenSet(undefined, { shownBefore: date }),
      todayISO: date,
      fetchTree,
      fetchCommits,
      fetchContributors,
      fetchDownloads,
    });
    discoveries.generated_at = new Date().toISOString();
    DiscoveriesStagingSchema.parse(discoveries);
    mkdirSync('data/staging', { recursive: true });
    writeFileSync(
      'data/staging/feeds-discoveries.json',
      `${JSON.stringify(discoveries, null, 2)}\n`,
    );
    banner(
      `discoveries: ${discoveries.stats.survivors} candidates, ${discoveries.stats.watchlisted} watchlisted (pool ${discoveries.stats.pool})`,
    );
  } catch (err) {
    // Non-fatal: discoveries is an observability artifact in P2, not yet a
    // report input. A funnel failure must not abort an otherwise-good collect.
    banner(`discoveries funnel FAILED (non-fatal in P2): ${err.message}`);
  }

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

// Same CLI-detection idiom as src/lib/snapshot.js: run the pipeline only when
// invoked as `node src/collect.js`, so tests can import the pure helpers.
const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
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
}
