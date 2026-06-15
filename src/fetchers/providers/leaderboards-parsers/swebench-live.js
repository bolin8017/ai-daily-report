import { fetchJson, fetchText } from './_base.js';

const CONTENTS = 'https://api.github.com/repos/SWE-bench-Live/swe-bench-live.github.io/contents/';
const RAW = 'https://raw.githubusercontent.com/SWE-bench-Live/swe-bench-live.github.io/main';

export function parseSwebenchLive(jsonl, preferred = 'verified', fallback = 'lite') {
  const rows = jsonl
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const pick = (set) => rows.filter((r) => r.set === set && r.total > 0);
  const chosen = pick(preferred).length ? pick(preferred) : pick(fallback);
  return chosen
    .map((r) => ({ model_id: r.name, score: (r.resolved / r.total) * 100 }))
    .filter((e) => e.model_id && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchSwebenchLive() {
  const files = await fetchJson(CONTENTS);
  const report = (Array.isArray(files) ? files : [])
    .map((f) => f.name)
    .filter((n) => /^reports-.*\.jsonl$/.test(n))
    .sort()
    .pop();
  if (!report) throw new Error('swebench-live: no reports-*.jsonl found');
  return parseSwebenchLive(await fetchText(`${RAW}/${report}`));
}
