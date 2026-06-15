// Single source of truth for benchmark leaderboard links.
//
// The leaderboard staging items carry only rankings (bench / top_5 / diffs) —
// no url. The tech curator was nonetheless asked to supply a "link to
// leaderboard" it had no source for, so it hallucinated a *different* (often
// 404) url every day — e.g. BFCL invented `huggingface.co/spaces/anybodys/BFCL`.
// (The now-removed OCRBench board pointed at six different fabricated
// repos/Spaces across one week before it was dropped.) These hand-verified pages
// are the only URLs that ever reach the rendered report — the provider stamps
// them onto staging and merge enforces them (see cureBenchmarkUrls in merge.js).
export const BENCH_LEADERBOARD_URL = {
  bfcl: 'https://gorilla.cs.berkeley.edu/leaderboard.html',
  'epoch-gpqa': 'https://epoch.ai/benchmarks/gpqa-diamond',
  'epoch-hle': 'https://epoch.ai/benchmarks/hle',
  gaia: 'https://huggingface.co/spaces/gaia-benchmark/leaderboard',
  lmarena: 'https://lmarena.ai/leaderboard',
  livebench: 'https://livebench.ai/',
  'swebench-live': 'https://swe-bench-live.github.io/',
  tau2: 'https://taubench.com/',
};

// Identify which benchmark a curated tech.benchmarks item refers to. Prefer an
// explicit `bench` field; otherwise match a known bench token at the title head
// ("BFCL: …"). Returns null for an unknown / hallucinated benchmark (e.g. a
// ghost "MTEB Leaderboard: …" item the curator invented from a stale prompt
// with no backing leaderboard data).
export function benchOf(item) {
  const bench = item?.bench;
  if (typeof bench === 'string' && bench in BENCH_LEADERBOARD_URL) return bench;
  const title = item?.title ?? '';
  if (/lmarena|chatbot arena/i.test(title)) return 'lmarena';
  if (/bfcl/i.test(title)) return 'bfcl';
  if (/livebench/i.test(title)) return 'livebench';
  if (/swe-?bench[- ]?live/i.test(title)) return 'swebench-live';
  if (/gpqa/i.test(title)) return 'epoch-gpqa';
  if (/hle|humanity'?s last exam/i.test(title)) return 'epoch-hle';
  if (/tau-?2|tau-?bench/i.test(title)) return 'tau2';
  if (/gaia/i.test(title)) return 'gaia';
  return null;
}
