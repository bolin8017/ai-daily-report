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

import { runAll } from './fetchers/run-all.js';
import { commitAndPush } from './lib/commit.js';
import { condenseAll } from './lib/condense.js';
import config from './lib/config.js';
import { tagItemScope } from './lib/scope.js';
import { buildSnapshot } from './lib/snapshot.js';
import { resolveEffectiveSources } from './lib/sources.js';
import { StagingMetadataSchema } from './schemas/staging.js';

const FEED_SOURCE_IDS = new Set([
  'hackernews',
  'hackernews-show',
  'dev-to-top',
  'lobsters',
  'changelog',
  'simon-willison',
  'gary-marcus',
  'karpathy',
  'eugene-yan',
  'hamel-husain',
  'lilian-weng',
  'sebastian-raschka',
  'latent-space',
  'anthropic-news',
  'google-ai-blog',
  'openai',
  'microsoft-research-ai',
  'aws-ml-blog',
  'nvidia-developer-blog',
  'meta-research',
  'samsung-semiconductor',
  'blocksandfiles',
  'vllm-releases',
  'lmcache-releases',
  'aidaptiv-phison-releases',
  'phoronix',
  'lwn',
  'segmentfault',
  'oschina',
  'ithome',
  'inside',
  'techorange',
  'technews-tw',
  'digitimes',
  'techcrunch-venture',
  'stratechery',
  'lawfare',
]);

// Map per-source chain results into the legacy `{feeds, trending, search,
// developers, leaderboards, mops, hf_trending, arxiv}` shape so downstream
// condense / snapshot / scope logic keeps working without per-source rewrite.
function mapResultsToLegacyShape(results) {
  const out = {};
  out.feeds = {
    ok: true,
    items: Object.entries(results)
      .filter(([id]) => FEED_SOURCE_IDS.has(id))
      .flatMap(([, r]) => r.items ?? []),
  };
  out.trending = results['github-trending'] ?? { ok: false, items: [] };
  out.search = results['github-search-topics'] ?? { ok: false, items: [] };
  out.developers = results['github-developers'] ?? { ok: false, items: [] };
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
  const sources = await resolveEffectiveSources();
  const { results, degraded } = await runAll(sources, {
    date,
    minHealthy: Math.ceil(sources.length / 3),
  });
  const raw = mapResultsToLegacyShape(results);
  if (degraded.length) raw._degraded = degraded;

  // Phase 2 — build feeds snapshot (committed to data/feeds-snapshot.json for 11ty)
  banner('building snapshot');
  buildSnapshot(raw.feeds);

  // Phase 3 — tag scope on RAW items BEFORE condense.
  // Items from global sources get ["global"]; items also matching a lens's
  // sources_overlay get ["global", "<lens-id>"]. Tagging here (rather than
  // post-condense) lets condense reserve quota for lens-tagged items so
  // low-star lens-overlay signals (e.g. niche github topics like kv-cache)
  // aren't crowded out by popular global items.
  // Only tag the 4 "core" fetchers — new IA-redesign fetchers (leaderboards,
  // mops, hf_trending, arxiv) bypass condense entirely (written raw to staging).
  for (const fetcherKey of ['feeds', 'trending', 'search', 'developers']) {
    if (raw[fetcherKey] && Array.isArray(raw[fetcherKey].items)) {
      raw[fetcherKey].items = raw[fetcherKey].items.map((item) =>
        tagItemScope(item, config.lenses),
      );
    }
  }

  // Phase 4 — condense per-source for prompt-size control (scope-aware)
  banner('condensing');
  const condensed = condenseAll(raw);

  // Phase 5 — write staging files for Stage 2 (agent analysis)
  banner('writing staging data');
  mkdirSync('data/staging', { recursive: true });

  // New IA-redesign fetchers are written raw (no condense step) since their
  // payloads are small + structured (leaderboards: 5 snapshots; mops: tracked
  // tickers only; hf_trending: 20 models; arxiv: ~50 papers).
  const files = {
    'data/staging/unified.json': condensed.unified,
    'data/staging/trending.json': condensed.trending,
    'data/staging/search.json': condensed.search,
    'data/staging/developers.json': condensed.developers,
    'data/staging/leaderboards.json': raw.leaderboards ?? { ok: false, items: [] },
    'data/staging/mops.json': raw.mops ?? { ok: false, items: [] },
    'data/staging/hf_trending.json': raw.hf_trending ?? { ok: false, items: [] },
    'data/staging/arxiv.json': raw.arxiv ?? { ok: false, items: [] },
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
      degraded: raw._degraded ?? [],
    },
  };

  // Validate metadata against schema before writing (contract with Stage 2)
  StagingMetadataSchema.parse(files['data/staging/metadata.json']);

  for (const [path, data] of Object.entries(files)) {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    console.error(`  ✓ ${path}`);
  }

  // Phase 6 — commit + push
  if (SKIP_PUSH) {
    banner('SKIP_PUSH — stopping before commit');
    return;
  }

  // Phase 3 pipeline redesign — under FEATURE_ARCHIVE_HOT_COLD=1, staging
  // + feeds-snapshot become Docker-volume-only ephemeral artifacts (no
  // longer committed). The data branch stays trimmed to reports + memory.
  if (process.env.FEATURE_ARCHIVE_HOT_COLD === '1') {
    banner('FEATURE_ARCHIVE_HOT_COLD=1 — skipping staging commit (volume-only)');
    return;
  }

  banner('committing staging data');
  const { pushed, sha } = await commitAndPush({
    date,
    message: `data: ${date} staging data collected`,
    paths: ['data/staging/', 'data/feeds-snapshot.json'],
  });
  banner(pushed ? `done — pushed ${sha}` : 'done — nothing to push');
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
