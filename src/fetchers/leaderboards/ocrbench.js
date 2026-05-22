#!/usr/bin/env node
// Adapter: OCRBench (Yuliang-Liu/MultimodalOCR).
// Strategy: parse markdown table from the GitHub repo README.

import { runAsStandalone } from '../_dispatch.js';
import { diffSnapshots, fetchText, loadPrevSnapshot, saveSnapshot } from './_base.js';

const README_URL = 'https://raw.githubusercontent.com/Yuliang-Liu/MultimodalOCR/main/README.md';
const BENCH = 'ocrbench';

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
  try {
    const md = await fetchText(README_URL);
    const entries = parseOcrBenchTable(md);
    if (entries.length === 0) {
      return { ok: false, bench: BENCH, items: [], error: 'No table parsed' };
    }
    const prev = await loadPrevSnapshot(BENCH);
    const diff = diffSnapshots(prev, entries);
    await saveSnapshot(BENCH, entries);
    return { ok: true, bench: BENCH, items: entries, diff };
  } catch (e) {
    return { ok: false, bench: BENCH, items: [], error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchOcrBench);
