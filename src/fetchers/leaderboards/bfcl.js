#!/usr/bin/env node
// Adapter: Berkeley Function Calling Leaderboard (BFCL).
// Strategy: scrape the leaderboard HTML table with cheerio.

import { load } from 'cheerio';
import { runAsStandalone } from '../_dispatch.js';
import { diffSnapshots, fetchText, loadPrevSnapshot, saveSnapshot } from './_base.js';

const BFCL_URL = 'https://gorilla.cs.berkeley.edu/leaderboard.html';
const BENCH = 'bfcl';

export function parseBfclTable(html) {
  const $ = load(html);
  const entries = [];
  $('table').each((_, tableEl) => {
    if (entries.length > 0) return; // first matching table only
    const $t = $(tableEl);
    const headers = $t
      .find('th')
      .map((_, h) => $(h).text().trim().toLowerCase())
      .get();
    const rankCol = headers.findIndex((h) => h.includes('rank'));
    const modelCol = headers.findIndex((h) => h.includes('model'));
    const scoreCol = headers.findIndex((h) => h.includes('overall') || h.includes('avg'));
    if (modelCol === -1) return;
    $t.find('tr')
      .slice(1)
      .each((_, rowEl) => {
        const cells = $(rowEl)
          .find('td')
          .map((_, c) => $(c).text().trim())
          .get();
        if (cells.length === 0) return;
        const rankRaw = rankCol >= 0 ? cells[rankCol] : String(entries.length + 1);
        const model = modelCol >= 0 ? cells[modelCol] : null;
        const score = scoreCol >= 0 ? parseFloat(cells[scoreCol]) : null;
        if (!model) return;
        entries.push({ model_id: model, rank: parseInt(rankRaw, 10), score });
      });
  });
  return entries;
}

export async function fetchBfcl() {
  try {
    const html = await fetchText(BFCL_URL);
    const entries = parseBfclTable(html);
    if (entries.length === 0) {
      return { ok: false, bench: BENCH, items: [], error: 'No entries parsed' };
    }
    const prev = await loadPrevSnapshot(BENCH);
    const diff = diffSnapshots(prev, entries);
    await saveSnapshot(BENCH, entries);
    return { ok: true, bench: BENCH, items: entries, diff };
  } catch (e) {
    return { ok: false, bench: BENCH, items: [], error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchBfcl);
