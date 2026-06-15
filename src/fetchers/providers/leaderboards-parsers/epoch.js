import { fetchText, parseCsv } from './_base.js';

const CSV_URL = 'https://epoch.ai/data/eci_benchmarks.csv';

export function parseEpoch(csvText, benchmark) {
  const best = new Map(); // model -> max performance
  for (const r of parseCsv(csvText)) {
    if (r.benchmark !== benchmark) continue;
    const name = (r.model || r.Model || '').trim();
    const perf = Number.parseFloat(r.performance);
    if (!name || !Number.isFinite(perf)) continue;
    if (!best.has(name) || perf > best.get(name)) best.set(name, perf);
  }
  return [...best.entries()]
    .map(([model_id, score]) => ({ model_id, score }))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

let _csvPromise = null; // memoize the single download across both sub-boards in one run
async function epochCsv() {
  if (!_csvPromise) {
    // Clear the cache on rejection so a failed download doesn't stick and starve
    // the second board — it can retry instead of replaying the same failure.
    _csvPromise = fetchText(CSV_URL).catch((e) => {
      _csvPromise = null;
      throw e;
    });
  }
  return _csvPromise;
}

export async function fetchEpoch(benchmark) {
  return parseEpoch(await epochCsv(), benchmark);
}
