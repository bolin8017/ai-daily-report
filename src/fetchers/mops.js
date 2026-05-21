#!/usr/bin/env node
// Fetcher: Taiwan TWSE 重大訊息 (major disclosures), filtered to Phison
// upstream/downstream tickers.
//
// Data source: TWSE OpenAPI (official, no auth).
// Endpoint: https://openapi.twse.com.tw/v1/opendata/t187ap04_L
//
// Pre-flight verified this is the right endpoint (see
// docs/superpowers/notes/2026-05-22-mops-preflight.md). Direct scraping of
// mops.twse.com.tw returns 403 for non-TW IPs; the OpenAPI works globally.
//
// Date format note: TWSE uses ROC years (民國年): subtract 1911 to get CE.
// e.g. 1150521 → 2026-05-21.

import { runAsStandalone } from './_dispatch.js';

export const TRACKED_TICKERS = [
  '8299', // Phison 群聯
  '2454', // MediaTek 聯發科
  '2330', // TSMC 台積電
  '3711', // ASE 日月光投控
  '2382', // Quanta 廣達
  '3231', // Wistron 緯創
  '6669', // Wiwynn 緯穎
  '2376', // Gigabyte 技嘉
  '2357', // ASUS 華碩
  '2353', // Acer 宏碁
];

const ENDPOINT = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L';
const USER_AGENT = 'ai-daily-report/1.0';

/**
 * Convert ROC date (民國年) to ISO date.
 * "1150521" → "2026-05-21"
 */
export function rocToIso(rocDate) {
  if (!rocDate || rocDate.length < 6) return null;
  const yearRoc = parseInt(rocDate.slice(0, -4), 10);
  const month = rocDate.slice(-4, -2);
  const day = rocDate.slice(-2);
  if (!yearRoc) return null;
  const year = yearRoc + 1911;
  return `${year}-${month}-${day}`;
}

/**
 * Normalize one TWSE OpenAPI disclosure row to our internal shape.
 */
export function normalizeDisclosure(row) {
  // TWSE OpenAPI quirk: the headline field is "主旨 " (with trailing space).
  // Support both "主旨" and "主旨 " for resilience to upstream cleanup.
  const headline = row['主旨 '] ?? row.主旨 ?? '';
  return {
    ticker: row.公司代號,
    ticker_name: row.公司名稱 ?? null,
    disclosure_date: rocToIso(row.出表日期),
    statement_date: rocToIso(row.發言日期),
    statement_time: row.發言時間 ?? null,
    // Decode common HTML entities ("代&#12070;" → "代為") that occasionally
    // appear in the upstream feed; full HTML decode is overkill here.
    headline: String(headline)
      .trim()
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))),
    basis: row.符合條款 ?? null,
    fact_date: rocToIso(row.事實發生日),
    detail: row.說明 ?? '',
    url: `https://mops.twse.com.tw/mops/web/t05st01?co_id=${row.公司代號}`,
  };
}

export async function fetchMops({ trackedTickers = TRACKED_TICKERS } = {}) {
  try {
    const resp = await fetch(ENDPOINT, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      return { ok: false, items: [], error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
      return { ok: false, items: [], error: 'Unexpected shape from TWSE OpenAPI' };
    }
    const trackedSet = new Set(trackedTickers);
    const items = data.filter((row) => trackedSet.has(row.公司代號)).map(normalizeDisclosure);
    return {
      ok: true,
      items,
      total_disclosures: data.length,
      tracked_tickers: trackedTickers.length,
    };
  } catch (e) {
    return { ok: false, items: [], error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchMops);
