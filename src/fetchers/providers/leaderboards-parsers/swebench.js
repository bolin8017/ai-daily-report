import { fetchJson } from './_base.js';

const PRIMARY_URL =
  'https://raw.githubusercontent.com/swe-bench/experiments/main/evaluation/verified/leaderboard.json';

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
  const raw = await fetchJson(PRIMARY_URL);
  return parseSwebenchResults(raw);
}
