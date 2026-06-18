// Deterministic, no-LLM report linter — greps the composed report's prose for
// defects the synthesizer prompt is asked to avoid but can drift on: leaked id
// slugs, mojibake, the project's own banned 套語 phrases, and unhedged
// forward-looking magnitudes. Findings → report.meta.lint. Pure, non-fatal:
// the caller (merge.js) wraps the call so a finding never aborts the report
// (cure-don't-abort, like the confidence band and the dangling-link cure).

// Leaked Hermes-Wiki id slugs (arc/topic/thread/pred). Require >=2 kebab
// segments after the prefix so legit single-segment words ("thread-safe",
// "topic-based") don't false-positive; real leaked slugs are multi-segment.
const SLUG_LEAK_RE = /\b(?:arc|topic|thread|pred)-[a-z0-9]+(?:-[a-z0-9]+)+\b/g;

// Encoding fallout: replacement char, 3+ question-mark runs, common
// GBK->UTF-8 mojibake markers.
const MOJIBAKE_RES = [/�/, /\?{3,}/, /锟斤拷/];

// quality.md 套語擴充 ban-list (copied verbatim).
const SLOP_PHRASES = [
  '值得關注',
  '不容忽視',
  '深入探討',
  '全面提升',
  '大勢所趨',
  '持續發酵',
  '的轉折點',
  '結構性切換',
  '產生深遠影響',
  '至關重要',
  '積極佈局',
  '前景看好',
  '時差狀態',
  '稀缺度極高',
  '時間窗口',
  '密切關注',
];

// Forward-claim hedging — shared with the synthesizer / curator prompt rules.
const HEDGE_RE = /預計|預估|預期|預測|將|上看|有望|估計|估算|forecast|projected|expected|likely/i;
const MAGNITUDE_RE = /\$\s?\d|\d\s*%|\d\s*(?:億|兆|萬)|\d\s*[x倍]/;
const YEAR_RE = /\b(20\d{2})\b/g;

const NON_SECTION_KEYS = new Set(['schema_version', 'date', 'theme', 'lead', 'signals', 'meta']);
const SIGNAL_FIELDS = ['title', 'body', 'mechanism', 'evidence', 'product_opportunity'];
const ITEM_FIELDS = ['title', 'takeaway', 'desc', 'relevance'];

function lintProseField(text, path, reportYear, isForwardScope, findings) {
  if (typeof text !== 'string' || text.length === 0) return;

  for (const m of text.matchAll(SLUG_LEAK_RE)) {
    findings.push({ check: 'slug_leak', path, snippet: m[0] });
  }
  for (const re of MOJIBAKE_RES) {
    const m = text.match(re);
    if (m) {
      findings.push({ check: 'mojibake', path, snippet: m[0] });
      break;
    }
  }
  for (const phrase of SLOP_PHRASES) {
    if (text.includes(phrase)) findings.push({ check: 'slop_phrase', path, snippet: phrase });
  }
  if (isForwardScope) {
    const hasFutureYear = [...text.matchAll(YEAR_RE)].some((m) => Number(m[1]) > reportYear);
    if (hasFutureYear && MAGNITUDE_RE.test(text) && !HEDGE_RE.test(text)) {
      findings.push({ check: 'unhedged_forward', path, snippet: text.slice(0, 80) });
    }
  }
}

/**
 * Lint the composed report's prose fields. Pure; returns findings + counts.
 * @param {object} report
 * @returns {{findings: {check: string, path: string, snippet: string}[], counts: Record<string, number>}}
 */
export function lintReport(report) {
  const findings = [];
  if (!report || typeof report !== 'object') return { findings, counts: {} };

  const reportYear = Number(String(report.date ?? '').slice(0, 4)) || 0;

  lintProseField(report.lead?.html, 'lead.html', reportYear, false, findings);

  const sig = report.signals ?? {};
  const walkSignal = (s, base) => {
    if (!s || typeof s !== 'object') return;
    for (const f of SIGNAL_FIELDS)
      lintProseField(s[f], `${base}.${f}`, reportYear, false, findings);
  };
  for (const [i, s] of (sig.focus ?? []).entries()) walkSignal(s, `signals.focus[${i}]`);
  walkSignal(sig.sleeper, 'signals.sleeper');
  walkSignal(sig.contrarian, 'signals.contrarian');
  for (const [i, p] of (sig.predictions ?? []).entries()) {
    lintProseField(p?.text, `signals.predictions[${i}].text`, reportYear, false, findings);
    lintProseField(
      p?.rationale,
      `signals.predictions[${i}].rationale`,
      reportYear,
      false,
      findings,
    );
  }

  for (const [key, section] of Object.entries(report)) {
    if (NON_SECTION_KEYS.has(key)) continue;
    if (!section || typeof section !== 'object') continue;
    const forwardScope = key === 'market' || key === 'tech';
    for (const [groupName, group] of Object.entries(section)) {
      if (!Array.isArray(group)) continue;
      for (const [i, item] of group.entries()) {
        if (!item || typeof item !== 'object') continue;
        for (const f of ITEM_FIELDS) {
          const isForward = forwardScope && f === 'takeaway';
          lintProseField(
            item[f],
            `${key}.${groupName}[${i}].${f}`,
            reportYear,
            isForward,
            findings,
          );
        }
      }
    }
  }

  const counts = {};
  for (const f of findings) counts[f.check] = (counts[f.check] ?? 0) + 1;
  return { findings, counts };
}
