import { fetchJson, fetchText, parseCsv } from './_base.js';

const CONTENTS = 'https://api.github.com/repos/LiveBench/livebench.github.io/contents/public';
const RAW = 'https://raw.githubusercontent.com/LiveBench/livebench.github.io/main/public';

export function parseLivebench(csvText) {
  const rows = parseCsv(csvText);
  return rows
    .map((r) => {
      const nums = Object.entries(r)
        .filter(([k]) => k !== 'model')
        .map(([, v]) => Number.parseFloat(v))
        .filter(Number.isFinite);
      const score = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : Number.NaN;
      return { model_id: r.model?.trim(), score };
    })
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchLivebench() {
  const files = await fetchJson(CONTENTS);
  const newest = (Array.isArray(files) ? files : [])
    .map((f) => f.name)
    .filter((n) => /^table_\d{4}_\d{2}_\d{2}\.csv$/.test(n))
    .sort()
    .pop();
  if (!newest) throw new Error('livebench: no table_*.csv found in public/');
  return parseLivebench(await fetchText(`${RAW}/${newest}`));
}
