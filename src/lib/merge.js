// Mechanical merge of editorial.json + curated/*.json → final report.json.
//
// This is the durable fix for the 32K output token cap that hit on
// 2026-05-24: by removing curated-section content from the synthesizer's
// output, the LLM only writes the editorial layer (~3-5K tokens) which
// stays well under any cap. The merge step is deterministic / pure /
// idempotent — same inputs produce the same output, safe to re-run.
//
// Activated under FEATURE_MERGE_STEP=1 via scripts/merge-report.sh which
// is called by the sequencer (src/pipeline/run.js) after the synthesizer succeeds.

import { EditorialSchema } from '../schemas/editorial.js';
import { buildReportSchema } from '../schemas/report.js';
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
    ['ideation.general', editorial.ideation?.general ?? []],
    ['ideation.work', editorial.ideation?.work ?? []],
  ];
  if (editorial.signals?.sleeper) blocks.push(['signals.sleeper', [editorial.signals.sleeper]]);
  if (editorial.signals?.contrarian) {
    blocks.push(['signals.contrarian', [editorial.signals.contrarian]]);
  }
  return blocks;
}

/**
 * Walk every signals/ideation item in editorial.json and yield each
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
 * Compose the final v2.1 report from validated editorial + curated inputs.
 *
 * Steps:
 *   1. Validate editorial against EditorialSchema
 *   2. Collect curated id space
 *   3. Check for dangling source_links — throws if any
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
export async function composeReport({ editorial, curated, meta, themeName = 'ai-builder' }) {
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
    ideation: cured.ideation,
  };
  // Observability block (assembled by the caller from per-stage sidecars).
  // Optional + pre-shaped; the report schema validates it as meta?.optional().
  if (meta) composed.meta = meta;
  // Spread curated sections under their declared section ids.
  const sections = await listActiveSections(themeName);
  for (const sec of sections) {
    composed[sec.id] = curated[sec.id] ?? {};
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
