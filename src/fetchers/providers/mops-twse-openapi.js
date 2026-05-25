import { defineProvider } from './_registry.js';

// MOPS 重大訊息 (material public disclosures). The official OpenAPI is split by
// listing venue: TWSE (上市) and TPEx (上櫃) each expose their own dataset with
// *different field names*. We fetch both and merge so a single watchlist can
// mix 上市 + 上櫃 tickers — notably 群聯 8299 (Phison itself) is 上櫃, so a
// TWSE-only fetch silently returned nothing for the headline ticker.
//
// (Provider id stays 'mops-twse-openapi' for the registry chain reference; it
// now covers both venues.)
const TWSE_ENDPOINT = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L';
const TPEX_ENDPOINT = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O';

// Phison (群聯 8299) ecosystem watchlist. Grouped by relationship; listing
// venue (上市/上櫃) is handled transparently by fetching both endpoints.
export const TRACKED_TICKERS = [
  // Phison + memory/storage controllers & modules
  '8299', // 群聯 Phison (上櫃)
  '2337', // 旺宏 Macronix
  '2344', // 華邦電 Winbond
  '2408', // 南亞科 Nanya
  '3260', // 威剛 ADATA (上櫃)
  '4967', // 十銓 TeamGroup
  '8271', // 宇瞻 Apacer
  '2451', // 創見 Transcend
  // aiDAPTIV+ AVL partners / AI server / PC / edge integrators
  '2376', // 技嘉 GIGABYTE
  '3515', // 華擎 ASRock
  '2395', // 研華 Advantech
  '6166', // 凌華 ADLINK
  '2377', // 微星 MSI
  '2357', // 華碩 ASUS
  '2353', // 宏碁 Acer
  '6669', // 緯穎 Wiwynn
  '2382', // 廣達 Quanta
  '3231', // 緯創 Wistron
  '2356', // 英業達 Inventec
  // Foundry / packaging / server silicon
  '2330', // 台積電 TSMC
  '3711', // 日月光 ASE
  '2454', // 聯發科 MediaTek
  '5274', // 信驊 Aspeed (上櫃)
];

function rocToIso(rocDate) {
  if (!rocDate || rocDate.length < 6) return null;
  const yearRoc = parseInt(rocDate.slice(0, -4), 10);
  const month = rocDate.slice(-4, -2);
  const day = rocDate.slice(-2);
  if (!yearRoc) return null;
  return `${yearRoc + 1911}-${month}-${day}`;
}

// Unified normalizer. TWSE rows key on 公司代號/公司名稱/出表日期/'主旨 ' (note
// the trailing space TWSE leaves in the key); TPEx rows use
// SecuritiesCompanyCode/CompanyName/Date/主旨. The remaining fields
// (發言日期/發言時間/符合條款/事實發生日/說明) share names across both.
function tickerOf(row) {
  return row.公司代號 ?? row.SecuritiesCompanyCode ?? null;
}

function normalizeDisclosure(row) {
  const ticker = tickerOf(row);
  const headline = row['主旨 '] ?? row.主旨 ?? '';
  return {
    ticker,
    ticker_name: row.公司名稱 ?? row.CompanyName ?? null,
    disclosure_date: rocToIso(row.出表日期 ?? row.Date),
    statement_date: rocToIso(row.發言日期),
    statement_time: row.發言時間 ?? null,
    headline: String(headline)
      .trim()
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))),
    basis: row.符合條款 ?? null,
    fact_date: rocToIso(row.事實發生日),
    detail: row.說明 ?? '',
    // MOPS (公開資訊觀測站) hosts both 上市 and 上櫃 disclosures.
    url: `https://mops.twse.com.tw/mops/web/t05st01?co_id=${ticker}`,
  };
}

async function fetchEndpoint(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('unexpected shape');
  return data;
}

export async function mopsTwseOpenapiProvider(cfg, _ctx) {
  const tickers = new Set(cfg.tickers ?? TRACKED_TICKERS);
  const settled = await Promise.allSettled([
    fetchEndpoint(TWSE_ENDPOINT),
    fetchEndpoint(TPEX_ENDPOINT),
  ]);

  const rows = [];
  const errors = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') rows.push(...r.value);
    else errors.push(r.reason?.message ?? String(r.reason));
  }

  // Only hard-fail if *both* venues failed; one venue down still yields data.
  if (rows.length === 0 && errors.length > 0) {
    return { ok: false, items: [], error: errors.join('; ') };
  }

  const items = rows.filter((row) => tickers.has(tickerOf(row))).map(normalizeDisclosure);
  return errors.length > 0 ? { ok: true, items, warnings: errors } : { ok: true, items };
}

defineProvider('mops-twse-openapi', mopsTwseOpenapiProvider);
