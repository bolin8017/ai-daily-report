import { fetchText } from './_base.js';

const README_URL = 'https://raw.githubusercontent.com/Yuliang-Liu/MultimodalOCR/main/README.md';

export function parseOcrBenchTable(markdown) {
  const lines = markdown.split('\n');
  const tableStart = lines.findIndex((l) => /\|\s*Model\s*\|/i.test(l));
  if (tableStart === -1) return [];
  const entries = [];
  for (let i = tableStart + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const model = cells[0];
    const score = parseFloat(cells[cells.length - 1]);
    if (Number.isNaN(score)) continue;
    entries.push({ model_id: model, score });
  }
  entries.sort((a, b) => b.score - a.score);
  return entries.map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function fetchOcrBench() {
  const md = await fetchText(README_URL);
  return parseOcrBenchTable(md);
}
