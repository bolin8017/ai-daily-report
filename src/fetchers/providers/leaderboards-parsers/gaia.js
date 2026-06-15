import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';

const PARQUET =
  'https://huggingface.co/datasets/gaia-benchmark/results_public/resolve/main/2023/test-00000-of-00001.parquet';

export function rankGaia(rows) {
  const best = new Map();
  for (const r of rows) {
    const name = (r.model || '').trim();
    if (r.score == null) continue; // parquet nulls: Number(null) === 0 would slip past isFinite
    const score = Number(r.score);
    if (!name || !Number.isFinite(score)) continue;
    if (!best.has(name) || score > best.get(name)) best.set(name, score);
  }
  return [...best.entries()]
    .map(([model_id, score]) => ({ model_id, score }))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchGaia() {
  const file = await asyncBufferFromUrl({ url: PARQUET });
  const rows = await parquetReadObjects({ file, columns: ['model', 'score'] });
  return rankGaia(rows);
}
