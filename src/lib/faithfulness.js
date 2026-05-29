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

/**
 * Flatten the editorial's prose-bearing fields. lead.html has no source_links
 * (sourceLinks=null → entity-match path); signal/ideation fields carry them.
 * @param {object} editorial
 * @returns {{path:string, text:string, sourceLinks:(string[]|null)}[]}
 */
export function collectProseFields(editorial) {
  const fields = [];
  const lead = editorial?.lead?.html;
  if (typeof lead === 'string') fields.push({ path: 'lead.html', text: lead, sourceLinks: null });

  const sig = editorial?.signals ?? {};
  const signalEntries = [
    ...(Array.isArray(sig.focus) ? sig.focus.map((it, i) => [`signals.focus[${i}]`, it]) : []),
    ...(sig.sleeper ? [['signals.sleeper', sig.sleeper]] : []),
    ...(sig.contrarian ? [['signals.contrarian', sig.contrarian]] : []),
  ];
  for (const [base, it] of signalEntries) {
    for (const f of ['body', 'mechanism']) {
      if (typeof it?.[f] === 'string') {
        fields.push({ path: `${base}.${f}`, text: it[f], sourceLinks: it.source_links ?? [] });
      }
    }
  }

  const ide = editorial?.ideation ?? {};
  for (const grp of ['general', 'work']) {
    const arr = Array.isArray(ide[grp]) ? ide[grp] : [];
    arr.forEach((it, i) => {
      if (typeof it?.description === 'string') {
        fields.push({
          path: `ideation.${grp}[${i}].description`,
          text: it.description,
          sourceLinks: it.source_links ?? [],
        });
      }
    });
  }
  return fields;
}

/**
 * Resolve a prose field to its curated source items. Fields with source_links
 * resolve by id-prefix; lead (sourceLinks=null) resolves by entity match — the
 * source name or a distinctive title appearing in the (lowercased) text.
 * @param {{sourceLinks:(string[]|null), text:string}} field
 * @param {{byPrefix:Map, items:object[]}} index
 * @returns {object[]}
 */
export function resolveFieldItems(field, { byPrefix, items }) {
  if (Array.isArray(field.sourceLinks)) {
    const out = [];
    for (const link of field.sourceLinks) {
      const it = byPrefix.get(idPrefix(link));
      if (it) out.push(it);
    }
    return out;
  }
  const text = (field.text ?? '').toLowerCase();
  return items.filter((it) => {
    const src = typeof it.source === 'string' ? it.source.toLowerCase() : '';
    const title = typeof it.title === 'string' ? it.title.toLowerCase() : '';
    return (src.length >= 4 && text.includes(src)) || (title.length >= 6 && text.includes(title));
  });
}

const SAME_DAY_RE = /同天|同日|今日|今天|本日|same[-\s]?day|today/i;

function dayDiff(a, b) {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(ms) / 86_400_000);
}

/**
 * Flag prose that uses a same-day marker while citing a source whose recovered
 * date is > toleranceDays from the report date. Conservative: the repair only
 * softens 同天→近期 (never wrong), so over-flagging is the safe direction.
 * @returns {{path:string, type:'temporal', marker:string, offDate:{id:string,date:string}[]}[]}
 */
export function detectTemporalFlags(editorial, index, { reportDate, toleranceDays = 1 } = {}) {
  const flags = [];
  for (const field of collectProseFields(editorial)) {
    const marker = field.text.match(SAME_DAY_RE);
    if (!marker) continue;
    const offDate = resolveFieldItems(field, index)
      .map((it) => ({ id: it.id, date: extractSourceDate(it.url) }))
      .filter((x) => x.date && dayDiff(x.date, reportDate) > toleranceDays);
    if (offDate.length > 0) {
      flags.push({ path: field.path, type: 'temporal', marker: marker[0], offDate });
    }
  }
  return flags;
}

const CLAIM_VERB_RE = /確認|證實|表示|指出|宣布|認為|confirmed|stated|said|showed|claims/i;
// Latin author name = two Capitalized tokens (Sebastian Raschka, Simon Willison…)
const NAME_RE = /[A-Z][a-z]+ [A-Z][a-z]+/g;

function extractSentence(text, needle) {
  const clean = text.replace(/<[^>]+>/g, ' ');
  const parts = clean.split(/(?<=[。！？!?\n])/);
  for (const p of parts) {
    if (p.includes(needle)) return p.trim();
  }
  return clean.trim();
}

function mentionsAuthor(item, author) {
  const a = author.toLowerCase();
  const aNoSpace = a.replace(/\s+/g, '');
  const src = (item.source ?? '').toLowerCase();
  const title = (item.title ?? '').toLowerCase();
  const id = (item.id ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return src.includes(a) || title.includes(a) || id.includes(aNoSpace);
}

/**
 * Find spans where a named author co-occurs with a claim verb. citedItems are
 * resolved by the same two paths as detectTemporalFlags, then filtered to the
 * named author. citedItems:[] (author not in the cited sources) is itself a
 * flag — the repair de-names it.
 * @returns {{path:string, author:string, span:string, citedItems:object[]}[]}
 */
export function detectAttributionClaims(editorial, index) {
  const claims = [];
  for (const field of collectProseFields(editorial)) {
    if (!CLAIM_VERB_RE.test(field.text)) continue;
    const names = [...new Set(field.text.match(NAME_RE) ?? [])];
    for (const author of names) {
      const span = extractSentence(field.text, author);
      if (!CLAIM_VERB_RE.test(span)) continue; // verb must be in the same sentence
      const citedItems = resolveFieldItems(field, index)
        .filter((it) => mentionsAuthor(it, author))
        .map((it) => ({
          id: it.id,
          title: it.title,
          takeaway: it.takeaway,
          source: it.source,
          date: extractSourceDate(it.url),
        }));
      claims.push({ path: field.path, author, span, citedItems });
    }
  }
  return claims;
}
