const URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';

// Pure: parse the API JSON response → [{ model_id, score, rank }] sorted by score desc,
// with null-index models filtered out.
export function parseAa(json) {
  const rows = json?.data ?? [];
  return rows
    .map((m) => ({
      model_id: m.name,
      score: m.evaluations?.artificial_analysis_intelligence_index,
    }))
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// KEY-GATED: returns [] when AA_API_KEY is absent or the API call fails.
// This is intentional — the pipeline must never break because of a missing key.
export async function fetchArtificialAnalysis() {
  const key = process.env.AA_API_KEY;
  if (!key) return []; // fail-soft: no key → skip this board, pipeline unaffected
  try {
    const resp = await fetch(URL, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return []; // fail-soft on any API error
    return parseAa(await resp.json());
  } catch {
    return []; // fail-soft on network / timeout errors
  }
}
