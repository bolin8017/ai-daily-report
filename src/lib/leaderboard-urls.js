// Single source of truth for benchmark leaderboard links.
//
// The leaderboard staging items carry only rankings (bench / top_5 / diffs) —
// no url. The tech curator was nonetheless asked to supply a "link to
// leaderboard" it had no source for, so it hallucinated a *different* (often
// 404) url every day: OCRBench pointed at six different fabricated repos/Spaces
// across one week; BFCL invented `huggingface.co/spaces/anybodys/BFCL`; only
// SWE-bench happened to land on the right url. These hand-verified pages are the
// only URLs that ever reach the rendered report — the provider stamps them onto
// staging and merge enforces them (see cureBenchmarkUrls in merge.js).
export const BENCH_LEADERBOARD_URL = {
  bfcl: 'https://gorilla.cs.berkeley.edu/leaderboard.html',
  swebench: 'https://www.swebench.com/',
  ocrbench: 'https://huggingface.co/spaces/ling99/OCRBench-v2-leaderboard',
};

// Identify which benchmark a curated tech.benchmarks item refers to. Prefer an
// explicit `bench` field; otherwise match a known bench token at the title head
// ("OCRBench: …", "BFCL: …", "SWE-Bench Verified: …"). Returns null for an
// unknown / hallucinated benchmark (e.g. a ghost "MTEB Leaderboard: …" item the
// curator invented from a stale prompt with no backing leaderboard data).
export function benchOf(item) {
  const bench = item?.bench;
  if (typeof bench === 'string' && bench in BENCH_LEADERBOARD_URL) return bench;
  const title = item?.title ?? '';
  if (/ocrbench/i.test(title)) return 'ocrbench';
  if (/bfcl/i.test(title)) return 'bfcl';
  if (/swe-?bench/i.test(title)) return 'swebench';
  return null;
}
