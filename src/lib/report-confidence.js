// Report-level confidence band — deterministic, no LLM, pure. Computed in
// merge (composeReport) and attached to report.meta.confidence. Citation
// coverage is the primary quality gate; unique-domain count is an anomaly
// floor (catches source-pool collapse); source tier is displayed context, not
// scored. No 0-100 score: a single number implies a precision these noisy
// proxies don't have, and only three coarse bands are ever consumed.
//
// Benign ESM cycle: this imports idPrefix from merge.js and merge.js imports
// computeConfidence from here. Both are function exports used at call time, so
// the live bindings resolve fine (same pattern faithfulness.js uses for idPrefix).

import { idPrefix } from './merge.js';

// Thresholds — interpretable, not weights. reliable: most analytical claims are
// cited AND the source pool isn't thin. thin: claims largely ungrounded OR the
// pool collapsed to a handful of domains.
const CITATION_RELIABLE = 0.7; // >= this share of claim-bearing signals cited
const DOMAINS_RELIABLE = 10; // >= this many distinct source domains
const CITATION_THIN = 0.4; // < this share cited
const DOMAINS_THIN = 5; // < this many domains

// Machine-derived sources (not LLM-summarized prose) — high trust.
const STRUCTURED_SOURCE_PREFIXES = [
  'leaderboards',
  'mops',
  'github-trending',
  'github-search',
  'github-developers',
  'hf-trending',
  'hf-daily-papers',
  'arxiv',
];
const AUTHORITATIVE_DOMAINS = new Set([
  'arxiv.org',
  'doi.org',
  'nature.com',
  'science.org',
  'ieee.org',
  'acm.org',
  'who.int',
  'worldbank.org',
]);

// Top-level report keys that are not curated item sections.
const NON_SECTION_KEYS = new Set(['schema_version', 'date', 'theme', 'lead', 'signals', 'meta']);

/**
 * Lowercased hostname with a leading "www." stripped, or null if unparseable.
 * @param {string} url
 * @returns {string|null}
 */
export function hostnameOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

function isAuthoritativeDomain(host) {
  if (!host) return false;
  if (AUTHORITATIVE_DOMAINS.has(host)) return true;
  // .gov / .edu / .org, including ccTLD forms like .gov.tw
  return /\.(gov|edu|org)(\.[a-z]{2,})?$/.test(host);
}

function isStructuredSource(source) {
  return typeof source === 'string' && STRUCTURED_SOURCE_PREFIXES.some((p) => source.startsWith(p));
}

function claimBearingSignals(signals) {
  const out = [...(signals?.focus ?? [])];
  if (signals?.sleeper) out.push(signals.sleeper);
  if (signals?.contrarian) out.push(signals.contrarian);
  return out;
}

function* iterItems(report) {
  for (const [key, section] of Object.entries(report)) {
    if (NON_SECTION_KEYS.has(key)) continue;
    if (!section || typeof section !== 'object') continue;
    for (const group of Object.values(section)) {
      if (!Array.isArray(group)) continue;
      for (const it of group) {
        if (it && typeof it === 'object') yield it;
      }
    }
  }
}

/**
 * Compute the report-level confidence band.
 * @param {object} report  the composed report (signals + curated sections)
 * @param {Set<string>} idSpace  curated item ids (for citation resolution)
 * @returns {{band: string|null, citation_coverage: number|null, cited_signals?: string, unique_domains: number, source_tier?: number}}
 */
export function computeConfidence(report, idSpace) {
  if (!report || typeof report !== 'object') {
    return { band: null, citation_coverage: null, unique_domains: 0 };
  }
  const prefixSpace = new Set();
  for (const id of idSpace ?? []) prefixSpace.add(idPrefix(id));

  // Primary gate: citation coverage over claim-bearing editorial signals.
  const signals = claimBearingSignals(report.signals);
  let coverage = null;
  let citedStr;
  if (signals.length > 0) {
    let cited = 0;
    for (const s of signals) {
      const links = Array.isArray(s.source_links) ? s.source_links : [];
      if (links.some((id) => prefixSpace.has(idPrefix(id)))) cited++;
    }
    coverage = cited / signals.length;
    citedStr = `${cited}/${signals.length}`;
  }

  // Source pool: distinct domains (anomaly floor) + trusted share (context).
  const domains = new Set();
  let total = 0;
  let trusted = 0;
  for (const it of iterItems(report)) {
    total++;
    const host = hostnameOf(it.url);
    if (host) domains.add(host);
    if (isStructuredSource(it.source) || isAuthoritativeDomain(host)) trusted++;
  }
  const uniqueDomains = domains.size;
  const sourceTier = total > 0 ? trusted / total : null;

  let band = null;
  if (coverage !== null) {
    if (coverage >= CITATION_RELIABLE && uniqueDomains >= DOMAINS_RELIABLE) band = 'reliable';
    else if (coverage < CITATION_THIN || uniqueDomains < DOMAINS_THIN) band = 'thin';
    else band = 'moderate';
  }

  const result = { band, citation_coverage: coverage, unique_domains: uniqueDomains };
  if (citedStr !== undefined) result.cited_signals = citedStr;
  if (sourceTier !== null) result.source_tier = sourceTier;
  return result;
}
