import YAML from 'yaml';
import { fetchText } from './_base.js';

// Aider's polyglot leaderboard is published as a YAML data file in the aider
// repo (the website renders it client-side, but the raw file is the canonical,
// stable, machine-readable source). Each entry is one benchmark run, and a model
// can appear several times (different edit formats / dates), so we keep the best
// pass_rate_2 (percent of the 225 exercises solved) per model, then rank.
const AIDER_YAML_URL =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml';

// Pure: parse polyglot_leaderboard.yml → [{ model_id, score, rank }] ranked by
// best pass_rate_2 per model descending.
export function parseAiderYaml(yamlText) {
  const rows = YAML.parse(yamlText);
  if (!Array.isArray(rows)) return [];
  const best = new Map();
  for (const r of rows) {
    const model_id = typeof r?.model === 'string' ? r.model.trim() : '';
    const score = Number.parseFloat(r?.pass_rate_2);
    if (!model_id || !Number.isFinite(score)) continue;
    const prev = best.get(model_id);
    if (prev === undefined || score > prev) best.set(model_id, score);
  }
  return [...best.entries()]
    .map(([model_id, score]) => ({ model_id, score }))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchAider() {
  return parseAiderYaml(await fetchText(AIDER_YAML_URL));
}
