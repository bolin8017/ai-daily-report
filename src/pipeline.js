#!/usr/bin/env node
// Main pipeline entry point. Runs end-to-end:
//   1. Fetch all 4 sources in parallel
//   2. Build feeds-snapshot (for 11ty)
//   3. Condense per-source for prompt-size control
//   4. Synthesize today's report via `claude -p`
//   5. Synthesize updated memory via `claude -p`
//   6. Validate both against Zod schemas
//   7. Commit + push to origin main
//
// On VM / Docker: invoked directly by cron. Locally: invoked by `npm start`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runFetchers } from './fetchers/all.js';
import { commitAndPush } from './lib/commit.js';
import { condenseAll } from './lib/condense.js';
import { buildSnapshot } from './lib/snapshot.js';
import { synthesizeMemory, synthesizeReport } from './lib/synthesize.js';
import { MemorySchema } from './schemas/memory.js';
import { ReportSchema } from './schemas/report.js';

const TZ = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const SKIP_PUSH = process.env.SKIP_PUSH === '1' || process.argv.includes('--skip-push');

function todayIn(tz) {
  // sv-SE format gives YYYY-MM-DD
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

function banner(msg) {
  console.error(`\n[pipeline] ${new Date().toISOString()} — ${msg}`);
}

async function main() {
  const date = todayIn(TZ);
  banner(`start ${date} (${TZ})${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // Phase 1 — fetch (parallel)
  banner('phase 1: fetch sources');
  const raw = await runFetchers();

  // Phase 1b — snapshot + condense (deterministic, in-memory)
  banner('phase 1b: snapshot + condense');
  buildSnapshot(raw.feeds);
  const condensed = condenseAll(raw);

  if (DRY_RUN) {
    banner('DRY RUN — stopping before synthesis');
    console.error(`  feeds: ${raw.feeds.items?.length ?? 0}`);
    console.error(`  trending: ${raw.trending.items?.length ?? 0}`);
    console.error(`  search: ${raw.search.items?.length ?? 0}`);
    console.error(`  developers: ${raw.developers.items?.length ?? 0}`);
    return;
  }

  // Phase 2 — read memory state, synthesize report
  const memory = existsSync('data/memory.json')
    ? JSON.parse(readFileSync('data/memory.json', 'utf8'))
    : { schema_version: 2, last_updated: null, short_term: null, long_term: null, topics: [] };

  banner('phase 2a: synthesize report');
  const t2a = Date.now();
  const report = await synthesizeReport({ date, condensed, memory });
  if (report.date !== date) {
    throw new Error(`[pipeline] report.date="${report.date}" does not match today="${date}"`);
  }
  ReportSchema.parse(report);
  mkdirSync('data/reports', { recursive: true });
  writeFileSync(`data/reports/${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`[pipeline] report written in ${((Date.now() - t2a) / 1000).toFixed(1)}s`);

  // Phase 3 — synthesize updated memory (uses the report we just wrote)
  banner('phase 2b: synthesize memory');
  const t2b = Date.now();
  const newMemory = await synthesizeMemory({ date, report, memory });
  MemorySchema.parse(newMemory);
  writeFileSync('data/memory.json', `${JSON.stringify(newMemory, null, 2)}\n`);
  console.error(`[pipeline] memory written in ${((Date.now() - t2b) / 1000).toFixed(1)}s`);

  // Phase 4 — commit + push
  if (SKIP_PUSH) {
    banner('SKIP_PUSH — stopping before commit');
    return;
  }
  banner('phase 3: commit + push');
  const { pushed, sha } = await commitAndPush({ date });
  banner(pushed ? `done — pushed ${sha}` : 'done — nothing to push');
}

main().catch((err) => {
  console.error(`[pipeline] FATAL: ${err.stack ?? err.message ?? String(err)}`);
  process.exit(1);
});
