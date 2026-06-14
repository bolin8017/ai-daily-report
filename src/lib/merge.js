// Mechanical merge of editorial.json + curated/*.json → final report.json.
//
// This is the durable fix for the 32K output token cap that hit on
// 2026-05-24: by removing curated-section content from the synthesizer's
// output, the LLM only writes the editorial layer (~3-5K tokens) which
// stays well under any cap. The merge step is deterministic / pure /
// idempotent — same inputs produce the same output, safe to re-run.
//
// Invoked as scripts/merge-report.sh by the sequencer (src/pipeline/run.js)
// after the synthesizer succeeds.

import { EditorialSchema } from '../schemas/editorial.js';
import { buildReportSchema } from '../schemas/report.js';
import { BENCH_LEADERBOARD_URL, benchOf } from './leaderboard-urls.js';
import { canonicalRepoKey } from './repo-key.js';
import { listActiveSections } from './theme.js';

/**
 * Enumerate the editorial blocks that may carry `source_links`, as
 * `[pathBase, itemsArray]` pairs. sleeper/contrarian are single objects, wrapped
 * in a one-element array so callers iterate uniformly. The wrapper array holds
 * the SAME object reference as `editorial.signals.{sleeper,contrarian}`, so a
 * caller that mutates `item.source_links` mutates the editorial in place.
 *
 * @param {object} editorial
 * @returns {Array<[string, object[]]>}
 */
function sourceLinkBlocks(editorial) {
  const blocks = [
    ['signals.focus', editorial.signals?.focus ?? []],
    ['signals.predictions', editorial.signals?.predictions ?? []],
  ];
  if (editorial.signals?.sleeper) blocks.push(['signals.sleeper', [editorial.signals.sleeper]]);
  if (editorial.signals?.contrarian) {
    blocks.push(['signals.contrarian', [editorial.signals.contrarian]]);
  }
  return blocks;
}

/**
 * Walk every signals item in editorial.json and yield each
 * source_links entry. Used both for dangling detection and for generating
 * helpful warning messages.
 *
 * @param {object} editorial
 * @returns {Generator<{path: string, id: string}>}
 */
function* iterSourceLinks(editorial) {
  for (const [pathBase, items] of sourceLinkBlocks(editorial)) {
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const links = item.source_links ?? [];
      for (const id of links) {
        yield { path: `${pathBase}[${idx}].source_links`, id };
      }
    }
  }
}

/**
 * Walk all curated sections + sub-groups and collect every item id into a Set.
 *
 * @param {object} curated  { shipped: {...}, pulse: {...}, market: {...}, tech: {...} }
 * @returns {Set<string>}
 */
export function extractIdSpace(curated) {
  const ids = new Set();
  for (const section of Object.values(curated ?? {})) {
    if (!section || typeof section !== 'object') continue;
    for (const group of Object.values(section)) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        if (item?.id) ids.add(item.id);
      }
    }
  }
  return ids;
}

/**
 * Reduce an item id to its unique "group.subgroup.index" prefix, dropping
 * the curator-appended ":slug" suffix. The synthesizer routinely references
 * source_links by prefix alone (it dropped every :slug on the 2026-05-28
 * run, which aborted the whole merge), so matching on the prefix — which is
 * already unique per item — is what makes the dangling check resilient to
 * that drift instead of throwing away an expensive synthesis.
 *
 * @param {string} id
 * @returns {string}
 */
export function idPrefix(id) {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(0, colon);
}

/**
 * Return a list of "<path>: <id>" strings, one per source_link in editorial
 * that doesn't resolve to any curated item id. Empty list means clean.
 * Matching is on the "group.subgroup.index" prefix (see idPrefix), so a
 * reference resolves whether or not it carries the curated ":slug" suffix.
 *
 * @param {object} editorial
 * @param {Set<string>} idSpace
 * @returns {string[]}
 */
export function findDanglingSourceLinks(editorial, idSpace) {
  const prefixSpace = new Set();
  for (const id of idSpace) {
    prefixSpace.add(idPrefix(id));
  }
  const dangling = [];
  for (const { path, id } of iterSourceLinks(editorial)) {
    if (!prefixSpace.has(idPrefix(id))) {
      dangling.push(`${path}: ${id}`);
    }
  }
  return dangling;
}

/**
 * Return a deep copy of `editorial` with every unresolvable `source_links` id
 * removed, plus the list of what was dropped. This is the Path-Y referential-
 * integrity cure: a dangling reference (an id whose `group.subgroup.index`
 * prefix matches no curated item) degrades to a dropped link — the citing item
 * still renders, just without that dead cross-tab anchor — instead of aborting
 * the whole report. Slug-only drift is already tolerated by idPrefix, so only
 * genuinely wrong coordinates are dropped. Resolvable ids (incl. bare-prefix
 * references) are preserved verbatim.
 *
 * @param {object} editorial
 * @param {Set<string>} idSpace
 * @returns {{editorial: object, dropped: string[]}}
 */
export function stripDanglingSourceLinks(editorial, idSpace) {
  const prefixSpace = new Set();
  for (const id of idSpace) prefixSpace.add(idPrefix(id));
  const cleaned = structuredClone(editorial);
  const dropped = [];
  for (const [pathBase, items] of sourceLinkBlocks(cleaned)) {
    for (let idx = 0; idx < items.length; idx++) {
      const links = items[idx]?.source_links;
      if (!Array.isArray(links)) continue;
      const kept = [];
      for (const id of links) {
        if (prefixSpace.has(idPrefix(id))) kept.push(id);
        else dropped.push(`${pathBase}[${idx}].source_links: ${id}`);
      }
      if (kept.length !== links.length) items[idx].source_links = kept;
    }
  }
  return { editorial: cleaned, dropped };
}

/**
 * Deterministic backstop for fabricated benchmark leaderboard links. The
 * leaderboard staging items carry no url, so the tech curator hallucinated a
 * (frequently 404) leaderboard url for each benchmark every run. Replace each
 * tech.benchmarks item's url with the canonical url for its bench, and strip the
 * url entirely for an unknown / ghost benchmark with no backing leaderboard so a
 * dead link never reaches the page. Returns a new array; inputs are not mutated.
 * Same cure-don't-abort philosophy as stripDanglingSourceLinks.
 *
 * @param {object[]} benchmarks
 * @returns {{benchmarks: object[], cured: number, stripped: number}}
 */
export function cureBenchmarkUrls(benchmarks) {
  let cured = 0;
  let stripped = 0;
  const out = benchmarks.map((item) => {
    const bench = benchOf(item);
    if (bench) {
      const url = BENCH_LEADERBOARD_URL[bench];
      if (item.url !== url) cured++;
      return { ...item, url };
    }
    if ('url' in item) {
      stripped++;
      const { url: _dropped, ...rest } = item;
      return rest;
    }
    return item;
  });
  return { benchmarks: out, cured, stripped };
}

/**
 * Attach deterministic signals from the staging file onto curator picks, rank
 * `rising` by `0.5·novelty + 0.5·excellence`, apply the soft anomaly ceiling,
 * and handle cold-start (no excellence data yet → provisional score).
 *
 * @param {{rising: object[], dev_watch: object[]}} curatedDiscoveries
 * @param {object|null} discoveriesStaging  parsed feeds-discoveries.json, or null
 * @returns {{rising: object[], dev_watch: object[]}}
 */
export function buildDiscoveriesSection(curatedDiscoveries, discoveriesStaging) {
  // Build a byKey map from staging candidates ∪ watchlist.
  const byKey = new Map();
  if (discoveriesStaging) {
    for (const item of [
      ...(discoveriesStaging.candidates ?? []),
      ...(discoveriesStaging.watchlist ?? []),
    ]) {
      const key = canonicalRepoKey(item);
      if (key) byKey.set(key, item);
    }
  }

  function attachSignals(item) {
    const key = canonicalRepoKey(item);
    const staging = key ? byKey.get(key) : undefined;
    if (!staging) return item;
    // Staging wins over any curator-copied value for these fields.
    const attached = { ...item };
    for (const field of [
      'excellence_score',
      'velocity_per_day',
      'eng_score',
      'repo_age_days',
      'stars_today',
      'validation_refs',
    ]) {
      if (staging[field] !== undefined) attached[field] = staging[field];
    }
    return attached;
  }

  function provisionalScore(item) {
    const starsClamped = Math.min((item.stars ?? 0) / 500, 1);
    const todayClamped = Math.min((item.stars_today ?? 0) / 100, 1);
    const validated = item.validation_refs?.length > 0 ? 1 : 0;
    const recency = Math.max(0, 1 - (item.repo_age_days ?? 30) / 30);
    return 0.4 * starsClamped + 0.3 * todayClamped + 0.2 * validated + 0.1 * recency;
  }

  function rankScore(item) {
    const novelty = (item.novelty_strength ?? 1) / 3;
    if (item.excellence_score != null) {
      return 0.5 * novelty + 0.5 * item.excellence_score;
    }
    return 0.5 * novelty + 0.5 * provisionalScore(item);
  }

  // Process rising: attach signals, mark provisional, rank, apply soft ceiling.
  // Default to [] so a degraded/empty curator output ({} or {rising:undefined})
  // composes to an empty section instead of throwing.
  // Never mutate the caller's input: attachSignals already returns a fresh
  // object when staging data is found; when no staging match is found it
  // returns the same reference — shallow-copy it before setting provisional.
  const risingAttached = (curatedDiscoveries.rising ?? []).map((raw) => {
    const attached = attachSignals(raw);
    const item = attached === raw ? { ...raw } : attached;
    if (item.excellence_score == null) item.provisional = true;
    return item;
  });
  risingAttached.sort((a, b) => rankScore(b) - rankScore(a));
  let rising = risingAttached;
  if (rising.length > 30) {
    console.warn(
      `[merge] discoveries.rising exceeded 30 (got ${rising.length}) — slicing; check funnel/curator`,
    );
    rising = rising.slice(0, 30);
  }

  // Process dev_watch: attach signals, pass through (no ceiling slice).
  const devWatch = (curatedDiscoveries.dev_watch ?? []).map(attachSignals);

  return { rising, dev_watch: devWatch };
}

/**
 * Compose the final v2.1 report from validated editorial + curated inputs.
 *
 * Steps:
 *   1. Validate editorial against EditorialSchema
 *   2. Collect curated id space
 *   3. Cure dangling source_links — drop unresolvable ones + warn (never throws)
 *   4. Compose: editorial fields + curated section objects, schema_version 2.1
 *   5. Validate composed report against buildReportSchema()
 *   6. Return the report (caller writes it to data/reports/<date>.json)
 *
 * @param {object} args
 * @param {object} args.editorial
 * @param {object} args.curated
 * @param {object} [args.meta]  optional report.meta observability block
 * @param {string} args.themeName  default "ai-builder"
 * @returns {Promise<object>}  validated v2.1 report
 */
export async function composeReport({
  editorial,
  curated,
  meta,
  themeName = 'ai-builder',
  discoveriesStaging = null,
}) {
  // 1. Validate editorial
  const editorialParsed = EditorialSchema.parse(editorial);

  // 2 + 3. Referential-integrity cure (Path Y): drop unresolvable source_links
  // and warn, rather than aborting the whole report on a single dead anchor.
  // The synthesizer prompt is the primary defense (cite-or-empty, never invent);
  // this is the deterministic backstop for whatever still slips through.
  const idSpace = extractIdSpace(curated);
  const { editorial: cured, dropped } = stripDanglingSourceLinks(editorialParsed, idSpace);
  if (dropped.length > 0) {
    console.warn(
      `[merge] dropped ${dropped.length} dangling source_link reference(s) — report still composed:\n  ${dropped.join('\n  ')}`,
    );
  }

  // 4. Compose
  const composed = {
    schema_version: 2.1,
    date: cured.date,
    lead: cured.lead,
    signals: cured.signals,
  };
  // Observability block (assembled by the caller from per-stage sidecars).
  // Optional + pre-shaped; the report schema validates it as meta?.optional().
  if (meta) composed.meta = meta;
  // Spread curated sections under their declared section ids.
  const sections = await listActiveSections(themeName);
  for (const sec of sections) {
    composed[sec.id] = curated[sec.id] ?? {};
  }
  // Apply discoveries signal re-attach + ranking (no-op when discoveries not in this theme).
  if (composed.discoveries) {
    composed.discoveries = buildDiscoveriesSection(
      composed.discoveries,
      discoveriesStaging ?? null,
    );
  }
  // Deterministic benchmark-url cure: overwrite LLM-fabricated leaderboard links
  // with the canonical url per bench (strip unknown/ghost ones). tech.benchmarks
  // is theme-specific + optional, hence guarded.
  if (Array.isArray(composed.tech?.benchmarks)) {
    const { benchmarks, cured, stripped } = cureBenchmarkUrls(composed.tech.benchmarks);
    composed.tech = { ...composed.tech, benchmarks };
    if (cured || stripped) {
      console.warn(
        `[merge] benchmark urls: ${cured} set to canonical, ${stripped} stripped (unknown bench)`,
      );
    }
  }
  // Preserve any extra editorial fields (passthrough)
  for (const [k, v] of Object.entries(cured)) {
    if (!(k in composed) && k !== 'schema_version' && k !== 'theme') {
      composed[k] = v;
    }
  }

  // 5. Validate composed report
  const reportSchema = await buildReportSchema(themeName);
  const validated = reportSchema.parse(composed);
  return validated;
}
