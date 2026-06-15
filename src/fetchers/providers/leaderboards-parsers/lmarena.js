import { fetchJson, fetchText } from './_base.js';

const BASE = 'https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data';

// Pure: parse text.json → [{ model_id, rank, score }] sorted by rank.
export function parseLmarena(jsonText) {
  const d = JSON.parse(jsonText);
  return (d.models ?? [])
    .map((m) => ({ model_id: m.model, rank: m.rank, score: m.score }))
    .filter((e) => e.model_id && Number.isFinite(e.rank))
    .sort((a, b) => a.rank - b.rank);
}

export async function fetchLmarena() {
  const ptr = await fetchJson(`${BASE}/latest.json`); // { date, path }
  return parseLmarena(await fetchText(`${BASE}/${ptr.path}/text.json`));
}
