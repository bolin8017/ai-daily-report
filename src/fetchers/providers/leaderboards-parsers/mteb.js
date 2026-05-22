import { fetchJson } from './_base.js';

const MTEB_RESULTS_URL = 'https://huggingface.co/datasets/mteb/leaderboard/raw/main/results.json';

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
  const raw = await fetchJson(MTEB_RESULTS_URL);
  const arr = Array.isArray(raw) ? raw : (raw?.results ?? []);
  return parseMtebResults(arr);
}
