import { defineProvider } from './_registry.js';

const ENDPOINT = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L';

export const TRACKED_TICKERS = [
  '8299',
  '2454',
  '2330',
  '3711',
  '2382',
  '3231',
  '6669',
  '2376',
  '2357',
  '2353',
];

function rocToIso(rocDate) {
  if (!rocDate || rocDate.length < 6) return null;
  const yearRoc = parseInt(rocDate.slice(0, -4), 10);
  const month = rocDate.slice(-4, -2);
  const day = rocDate.slice(-2);
  if (!yearRoc) return null;
  return `${yearRoc + 1911}-${month}-${day}`;
}

function normalizeDisclosure(row) {
  const headline = row['主旨 '] ?? row.主旨 ?? '';
  return {
    ticker: row.公司代號,
    ticker_name: row.公司名稱 ?? null,
    disclosure_date: rocToIso(row.出表日期),
    statement_date: rocToIso(row.發言日期),
    statement_time: row.發言時間 ?? null,
    headline: String(headline)
      .trim()
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))),
    basis: row.符合條款 ?? null,
    fact_date: rocToIso(row.事實發生日),
    detail: row.說明 ?? '',
    url: `https://mops.twse.com.tw/mops/web/t05st01?co_id=${row.公司代號}`,
  };
}

export async function mopsTwseOpenapiProvider(cfg, _ctx) {
  const tickers = new Set(cfg.tickers ?? TRACKED_TICKERS);
  try {
    const res = await fetch(ENDPOINT, {
      headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false, items: [], error: 'unexpected shape' };
    const items = data.filter((r) => tickers.has(r.公司代號)).map(normalizeDisclosure);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('mops-twse-openapi', mopsTwseOpenapiProvider);
