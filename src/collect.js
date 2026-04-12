#!/usr/bin/env node
// Stage 1: Data collection pipeline.
//
// Fetches all sources in parallel, condenses each to ≤8500 tokens,
// builds the feeds snapshot for 11ty, and writes everything to
// data/staging/ for Stage 2 (agent analysis).
//
// Pure Node.js — no LLM dependency.

import { mkdirSync, writeFileSync } from 'node:fs';
import { runFetchers } from './fetchers/all.js';
import { commitAndPush } from './lib/commit.js';
import { condenseAll } from './lib/condense.js';
import { buildSnapshot } from './lib/snapshot.js';

const TZ = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
const SKIP_PUSH = process.env.SKIP_PUSH === '1' || process.argv.includes('--skip-push');

function todayIn(tz) {
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

function banner(msg) {
  console.error(`\n[collect] ${new Date().toISOString()} — ${msg}`);
}

async function main() {
  const date = todayIn(TZ);
  banner(`start ${date} (${TZ})`);

  // Phase 1 — fetch all 4 sources in parallel
  banner('fetching sources');
  const raw = await runFetchers();

  // Phase 2 — build feeds snapshot (committed to data/feeds-snapshot.json for 11ty)
  banner('building snapshot');
  buildSnapshot(raw.feeds);

  // Phase 3 — condense per-source for prompt-size control
  banner('condensing');
  const condensed = condenseAll(raw);

  // Phase 4 — write staging files for Stage 2 (agent analysis)
  banner('writing staging data');
  mkdirSync('data/staging', { recursive: true });

  const files = {
    'data/staging/unified.json': condensed.unified,
    'data/staging/trending.json': condensed.trending,
    'data/staging/search.json': condensed.search,
    'data/staging/developers.json': condensed.developers,
    'data/staging/metadata.json': {
      date,
      collected_at: new Date().toISOString(),
      timezone: TZ,
      sources: {
        feeds: { ok: raw.feeds.ok, count: raw.feeds.items?.length ?? 0 },
        trending: { ok: raw.trending.ok, count: raw.trending.items?.length ?? 0 },
        search: { ok: raw.search.ok, count: raw.search.items?.length ?? 0 },
        developers: { ok: raw.developers.ok, count: raw.developers.items?.length ?? 0 },
      },
    },
  };

  for (const [path, data] of Object.entries(files)) {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    console.error(`  ✓ ${path}`);
  }

  // Phase 5 — commit + push
  if (SKIP_PUSH) {
    banner('SKIP_PUSH — stopping before commit');
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
  console.error(`[collect] FATAL: ${err.stack ?? err.message ?? String(err)}`);
  process.exit(1);
});
