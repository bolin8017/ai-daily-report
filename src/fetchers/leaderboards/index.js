#!/usr/bin/env node
// Parallel runner for all leaderboard adapters.
// Tolerates per-adapter failures; returns aggregate items + per-bench health.

import { runAsStandalone } from '../_dispatch.js';
import { fetchBfcl } from './bfcl.js';
import { fetchMteb } from './mteb.js';
import { fetchOcrBench } from './ocrbench.js';
import { fetchPinchBench } from './pinchbench.js';
import { fetchSwebench } from './swebench.js';

const ADAPTERS = [
  { bench: 'mteb', fn: fetchMteb },
  { bench: 'pinchbench', fn: fetchPinchBench },
  { bench: 'bfcl', fn: fetchBfcl },
  { bench: 'swebench', fn: fetchSwebench },
  { bench: 'ocrbench', fn: fetchOcrBench },
];

export async function fetchLeaderboards() {
  const results = await Promise.all(
    ADAPTERS.map(async ({ bench, fn }) => {
      try {
        return await fn();
      } catch (e) {
        return { ok: false, bench, items: [], error: e.message };
      }
    }),
  );
  const items = results.filter((r) => r.ok).map((r) => ({ bench: r.bench, ...r }));
  const failed = results.filter((r) => !r.ok).map((r) => r.bench);
  return {
    ok: failed.length === 0,
    items,
    per_bench: results,
    failed,
  };
}

runAsStandalone(import.meta.url, fetchLeaderboards);
