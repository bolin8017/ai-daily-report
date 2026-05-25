import { fetchText, parseCsv } from './_base.js';

// OCRBench-v2 leaderboard, served as a CSV from the HF Space (resolve endpoint
// 307-redirects to the HF CDN; Node fetch follows redirects). The CSV is
// unsorted, so we rank by Average Score descending. (The old v1 README markdown
// scrape — Yuliang-Liu/MultimodalOCR — is a different, smaller benchmark.)
const OCRBENCH_CSV_URL =
  'https://huggingface.co/spaces/ling99/OCRBench-v2-leaderboard/resolve/main/OCRBench_en.csv';

// Pure: parse OCRBench_en.csv → [{ model_id, score, rank }] ranked by score.
export function parseOcrBenchCsv(csvText) {
  return parseCsv(csvText)
    .map((r) => ({ model_id: r.Model?.trim(), score: Number.parseFloat(r['Average Score']) }))
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchOcrBench() {
  return parseOcrBenchCsv(await fetchText(OCRBENCH_CSV_URL));
}
