// Stage 3.5 faithfulness guard — detect + soft-repair the two recurring
// connective-tissue hallucinations (temporal "同天" fabrication, named-author
// misattribution) before publish. Pure + in-place; scripts/check-faithfulness.sh
// wires the file I/O + the one claude -p judge call.
//
// Method: decompose-then-verify against ONLY the cited source's takeaway
// (RAGAS faithfulness arXiv:2309.15217, FACTS Grounding arXiv:2501.03200,
// Anthropic quote-first). Dates are extracted deterministically, never reasoned
// over by the LLM (ChronoQA / date-tokenization unreliability). Repair softens
// rather than aborts; never autonomous self-correction (TACL 2025 survey).

import { idPrefix } from './merge.js';

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function normalizeMonth(m) {
  if (/^\d{1,2}$/.test(m)) {
    const n = Number(m);
    return n >= 1 && n <= 12 ? String(n).padStart(2, '0') : null;
  }
  return MONTHS[m.slice(0, 3).toLowerCase()] ?? null;
}

/**
 * Recover a source's publish date from its URL path. Returns 'YYYY-MM-DD' or null.
 * @param {string} url
 * @returns {string|null}
 */
export function extractSourceDate(url) {
  if (typeof url !== 'string') return null;
  const iso = url.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const mm = normalizeMonth(iso[2]);
    const dd = Number(iso[3]);
    if (mm && dd >= 1 && dd <= 31) return `${iso[1]}-${mm}-${iso[3]}`;
    return null;
  }
  const path = url.match(/\/(\d{4})\/(\d{1,2}|[A-Za-z]{3,9})\/(\d{1,2})(?=\/|#|\?|$)/);
  if (path) {
    const mm = normalizeMonth(path[2]);
    const dd = Number(path[3]);
    if (mm && dd >= 1 && dd <= 31) {
      return `${path[1]}-${mm}-${String(path[3]).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Index curated items by id-prefix (same resolution as merge's dangling check)
 * and keep a flat list for the lead's entity-match path.
 * @param {object} curated  { shipped:{...}, pulse:{...}, market:{...}, tech:{...} }
 * @returns {{ byPrefix: Map<string, object>, items: object[] }}
 */
export function buildCuratedIndex(curated) {
  const byPrefix = new Map();
  const items = [];
  for (const section of Object.values(curated ?? {})) {
    if (!section || typeof section !== 'object') continue;
    for (const group of Object.values(section)) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        if (item?.id) {
          byPrefix.set(idPrefix(item.id), item);
          items.push(item);
        }
      }
    }
  }
  return { byPrefix, items };
}
