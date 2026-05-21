#!/usr/bin/env node
// Adapter: MTEB embedding/retrieval leaderboard.
// Strategy: fetch the leaderboard dataset's results JSON. If that fails, return
// ok:false so the runner can tolerate the adapter individually.

import { runAsStandalone } from '../_dispatch.js';
import { diffSnapshots, fetchJson, loadPrevSnapshot, saveSnapshot } from './_base.js';

const MTEB_RESULTS_URL = 'https://huggingface.co/datasets/mteb/leaderboard/raw/main/results.json';

const BENCH = 'mteb';

export function parseMtebResults(raw) {
  const sorted = [...raw].sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0));
  return sorted.map((r, i) => ({
    model_id: r.model,
    rank: i + 1,
    score: r.avg_score ?? null,
    retrieval: r.retrieval ?? null,
  }));
}

export async function fetchMteb() {
  try {
    const raw = await fetchJson(MTEB_RESULTS_URL);
    const arr = Array.isArray(raw) ? raw : (raw?.results ?? []);
    if (arr.length === 0) {
      return { ok: false, items: [], bench: BENCH, error: 'Empty results' };
    }
    const entries = parseMtebResults(arr);
    const prev = await loadPrevSnapshot(BENCH);
    const diff = diffSnapshots(prev, entries);
    await saveSnapshot(BENCH, entries);
    return { ok: true, bench: BENCH, items: entries, diff };
  } catch (e) {
    return { ok: false, items: [], bench: BENCH, error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchMteb);
