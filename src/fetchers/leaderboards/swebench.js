#!/usr/bin/env node
// Adapter: SWE-bench Verified leaderboard.
// Strategy: fetch from the SWE-bench experiments repo's JSON leaderboard.

import { runAsStandalone } from '../_dispatch.js';
import { diffSnapshots, fetchJson, loadPrevSnapshot, saveSnapshot } from './_base.js';

const PRIMARY_URL =
  'https://raw.githubusercontent.com/swe-bench/experiments/main/evaluation/verified/leaderboard.json';

const BENCH = 'swebench';

export function parseSwebenchResults(raw) {
  const arr = raw?.results ?? raw?.entries ?? (Array.isArray(raw) ? raw : []);
  const sorted = [...arr].sort((a, b) => (b.resolved_rate ?? 0) - (a.resolved_rate ?? 0));
  return sorted.map((r, i) => ({
    model_id: r.model ?? r.system ?? r.name,
    rank: i + 1,
    score: r.resolved_rate ?? r.score ?? null,
  }));
}

export async function fetchSwebench() {
  try {
    const raw = await fetchJson(PRIMARY_URL);
    const entries = parseSwebenchResults(raw);
    if (entries.length === 0) {
      return { ok: false, bench: BENCH, items: [], error: 'Empty results' };
    }
    const prev = await loadPrevSnapshot(BENCH);
    const diff = diffSnapshots(prev, entries);
    await saveSnapshot(BENCH, entries);
    return { ok: true, bench: BENCH, items: entries, diff };
  } catch (e) {
    return { ok: false, bench: BENCH, items: [], error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchSwebench);
