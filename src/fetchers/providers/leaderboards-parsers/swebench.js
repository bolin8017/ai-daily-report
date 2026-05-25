import { fetchJson } from './_base.js';

// The official leaderboard site's own data file. Note: branch is `master`, and
// the file holds several named leaderboards; we track "Verified" and rank by
// `resolved` (% of SWE-bench Verified instances solved). The old
// swe-bench/experiments path no longer exists.
const SWEBENCH_URL =
  'https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json';
const DEFAULT_SPLIT = 'Verified';

// Pure: pick the named leaderboard, rank its entries by `resolved` desc.
export function parseSwebenchLeaderboards(data, split = DEFAULT_SPLIT) {
  const boards = Array.isArray(data?.leaderboards) ? data.leaderboards : [];
  const board = boards.find((b) => b.name === split);
  if (!board || !Array.isArray(board.results)) return [];
  return board.results
    .map((r) => ({ model_id: r.name?.trim(), score: Number.parseFloat(r.resolved) }))
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchSwebench() {
  return parseSwebenchLeaderboards(await fetchJson(SWEBENCH_URL));
}
