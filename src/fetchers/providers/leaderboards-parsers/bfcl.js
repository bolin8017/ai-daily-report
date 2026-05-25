import { fetchText, parseCsv } from './_base.js';

// The BFCL leaderboard page (gorilla.cs.berkeley.edu/leaderboard.html) is now
// JS-rendered — the static HTML has an empty table. The page's own JS fetches
// this CSV, so we read it directly (stable, pre-sorted by Rank, no auth).
const BFCL_CSV_URL = 'https://gorilla.cs.berkeley.edu/data_overall.csv';

// Pure: parse data_overall.csv → [{ model_id, rank, score }] sorted by rank.
export function parseBfclCsv(csvText) {
  return parseCsv(csvText)
    .map((r) => ({
      model_id: r.Model?.trim(),
      rank: Number.parseInt(r.Rank, 10),
      score: Number.parseFloat(r['Overall Acc']), // e.g. "77.47%" → 77.47
    }))
    .filter((e) => e.model_id && Number.isFinite(e.rank))
    .sort((a, b) => a.rank - b.rank);
}

export async function fetchBfcl() {
  return parseBfclCsv(await fetchText(BFCL_CSV_URL));
}
