import { fetchJson } from './_base.js';

const BASE =
  'https://raw.githubusercontent.com/sierra-research/tau2-bench/main/web/leaderboard/public/submissions';

// Pure: aggregate an array of submission objects into a ranked leaderboard.
// Board score = mean of the available finite pass_1 values across all domains.
// Submissions with no finite pass_1 are dropped.
export function aggregateTau2(submissions) {
  return submissions
    .map((s) => {
      const passes = Object.values(s?.results ?? {})
        .map((d) => d?.pass_1)
        .filter((v) => Number.isFinite(v));
      const score = passes.length ? passes.reduce((a, b) => a + b, 0) / passes.length : Number.NaN;
      return { model_id: s?.model_name, score };
    })
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchTau2() {
  const manifest = await fetchJson(`${BASE}/manifest.json`);
  const ids = Array.isArray(manifest?.submissions) ? manifest.submissions : [];
  if (ids.length === 0) throw new Error('tau2: empty submissions manifest');
  const subs = await Promise.all(
    ids.map((id) => fetchJson(`${BASE}/${id}/submission.json`).catch(() => null)),
  );
  const alive = subs.filter(Boolean);
  if (alive.length < ids.length) {
    console.warn(`[tau2] ${ids.length - alive.length}/${ids.length} submissions failed to fetch`);
  }
  return aggregateTau2(alive);
}
