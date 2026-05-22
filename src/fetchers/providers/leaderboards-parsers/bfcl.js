import { load } from 'cheerio';
import { fetchText } from './_base.js';

const BFCL_URL = 'https://gorilla.cs.berkeley.edu/leaderboard.html';

export function parseBfclTable(html) {
  const $ = load(html);
  const entries = [];
  $('table').each((_, tableEl) => {
    if (entries.length > 0) return;
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
  const html = await fetchText(BFCL_URL);
  return parseBfclTable(html);
}
