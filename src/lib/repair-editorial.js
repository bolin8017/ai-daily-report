// Repair known LLM-drift patterns in editorial.json before EditorialSchema
// validation, so cosmetic synthesizer variance never aborts a full daily run.
//
// Two patterns are handled:
//
//   1. Terse prediction_updates. The synthesizer prompt asks it to "update the
//      status for each prediction in memory.json", which the model sometimes
//      reads as "emit a {id, status} delta" — dropping the schema-required
//      `text` / `resolution_date`. On 2026-05-27 all 43 prediction_updates
//      came back as {id, status} only, EditorialSchema rejected them, and the
//      whole run aborted before any report was written. Those fields already
//      live in data/memory.json keyed by the same id, so we backfill from
//      there rather than discard an expensive synthesis.
//
//   2. Out-of-enum `status` (e.g. an invented "needs_revision"). Coerced to
//      "unverifiable" — preserves the prior inline safety net in
//      synthesize.sh, now consolidated here.
//
// Pure and in-place: mutates `editorial.signals.{predictions,prediction_updates}`
// and returns a stats object. No fs access, so it is unit-testable;
// scripts/synthesize.sh wires in the file I/O.

const VALID_STATUS = new Set(['pending', 'resolved-yes', 'resolved-no', 'unverifiable']);

/**
 * @param {object} editorial  parsed editorial.json (mutated in place)
 * @param {object} memory     parsed memory.json (read-only); memory.predictions
 *                            supplies text/resolution_date for backfill
 * @returns {{backfilled: number, statusCoerced: number, dropped: number}}
 */
export function repairEditorial(editorial, memory) {
  const stats = { backfilled: 0, statusCoerced: 0, dropped: 0 };

  const memById = new Map();
  for (const p of memory?.predictions ?? []) {
    if (p && typeof p.id === 'string') memById.set(p.id, p);
  }

  const signals = editorial?.signals;
  if (!signals || typeof signals !== 'object') return stats;

  for (const key of ['predictions', 'prediction_updates']) {
    const list = signals[key];
    if (!Array.isArray(list)) continue;

    const out = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      let next = entry;

      const missingRequired =
        typeof next.text !== 'string' || typeof next.resolution_date !== 'string';
      if (missingRequired && typeof next.id === 'string' && memById.has(next.id)) {
        // Start from the full memory record, then overlay the synthesizer's
        // defined fields (e.g. an updated status). Skipping `undefined` keeps
        // an absent LLM field from clobbering a good memory value.
        next = { ...memById.get(next.id) };
        for (const [k, v] of Object.entries(entry)) {
          if (v !== undefined) next[k] = v;
        }
        stats.backfilled++;
      }

      // Still missing a required string and no memory to draw from — drop the
      // single entry rather than abort the whole pipeline on it.
      if (typeof next.text !== 'string' || typeof next.resolution_date !== 'string') {
        stats.dropped++;
        continue;
      }

      // Coerce an out-of-enum status to "unverifiable".
      if (typeof next.status === 'string' && !VALID_STATUS.has(next.status)) {
        if (next === entry) next = { ...entry };
        next.status = 'unverifiable';
        stats.statusCoerced++;
      }

      out.push(next);
    }
    signals[key] = out;
  }

  return stats;
}
