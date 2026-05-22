import { fetchJson } from './_base.js';

const PRIMARY_URL =
  'https://raw.githubusercontent.com/pinchbench/pinchbench/main/results/leaderboard.json';
const FALLBACK_URL = 'https://pinchbench.com/api/leaderboard';

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
      if (entries.length > 0) return entries;
    } catch {
      // try next URL
    }
  }
  throw new Error('All pinchbench endpoints failed');
}
