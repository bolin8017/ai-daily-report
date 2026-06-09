// Repair known LLM-drift patterns in editorial.json before EditorialSchema
// validation, so cosmetic synthesizer variance never aborts a full daily run.
//
// One pattern is handled:
//
//   1. Terse / out-of-enum prediction entries. The synthesizer sometimes emits
//      a prediction_update as a bare {id, status} delta — dropping the
//      schema-required `text` / `resolution_date`. Cross-day memory was retired
//      with the Hermes Wiki migration, so there is no longer a store to backfill
//      those fields from: an entry still missing them is dropped (one entry,
//      never the whole run) rather than aborting at the Stage 3 schema gate. An
//      out-of-enum `status` (e.g. an invented "needs_revision") on an otherwise
//      complete entry is coerced to "unverifiable".
//
// Pure and in-place: mutates `editorial.signals.{predictions,prediction_updates}`,
// returning a stats object. No fs access, so it is unit-testable;
// scripts/synthesize.sh wires in the file I/O.

const VALID_STATUS = new Set(['pending', 'resolved-yes', 'resolved-no', 'unverifiable']);

/**
 * @param {object} editorial  parsed editorial.json (mutated in place)
 * @returns {{statusCoerced: number, dropped: number}}
 */
export function repairEditorial(editorial) {
  const stats = { statusCoerced: 0, dropped: 0 };

  const signals = editorial?.signals;
  if (!signals || typeof signals !== 'object') return stats;

  for (const key of ['predictions', 'prediction_updates']) {
    const list = signals[key];
    if (!Array.isArray(list)) continue;

    const out = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      let next = entry;

      // Cross-day memory is retired, so a terse entry can no longer be
      // backfilled — drop the single entry rather than abort the whole
      // pipeline on it.
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
