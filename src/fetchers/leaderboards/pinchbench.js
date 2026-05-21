#!/usr/bin/env node
// Adapter: PinchBench (agent benchmark, 147 tasks across 8 categories).
// Strategy: try GitHub repo's raw results JSON first; fall back to the site's
// API if exposed. Returns ok:false on full failure (runner tolerates).

import { runAsStandalone } from '../_dispatch.js';
import { diffSnapshots, fetchJson, loadPrevSnapshot, saveSnapshot } from './_base.js';

const PRIMARY_URL =
  'https://raw.githubusercontent.com/pinchbench/pinchbench/main/results/leaderboard.json';
const FALLBACK_URL = 'https://pinchbench.com/api/leaderboard';

const BENCH = 'pinchbench';

export function parsePinchBenchResults(raw) {
  const arr = raw?.results ?? raw?.entries ?? (Array.isArray(raw) ? raw : []);
  const sorted = [...arr].sort((a, b) => (b.success_rate ?? 0) - (a.success_rate ?? 0));
  return sorted.map((r, i) => ({
    model_id: r.model ?? r.model_id ?? r.name,
    rank: i + 1,
    score: r.success_rate ?? r.score ?? null,
    speed: r.speed ?? null,
    cost: r.cost ?? null,
  }));
}

export async function fetchPinchBench() {
  for (const url of [PRIMARY_URL, FALLBACK_URL]) {
    try {
      const raw = await fetchJson(url);
      const entries = parsePinchBenchResults(raw);
      if (entries.length === 0) continue;
      const prev = await loadPrevSnapshot(BENCH);
      const diff = diffSnapshots(prev, entries);
      await saveSnapshot(BENCH, entries);
      return { ok: true, bench: BENCH, items: entries, diff };
    } catch {
      // try next URL
    }
  }
  return { ok: false, bench: BENCH, items: [], error: 'All endpoints failed' };
}

runAsStandalone(import.meta.url, fetchPinchBench);
