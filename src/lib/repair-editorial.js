// Repair known LLM-drift patterns in editorial.json before EditorialSchema
// validation, so cosmetic synthesizer variance never aborts a full daily run.
//
// Two patterns are handled:
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
//   2. Ideation field drift. The synthesizer intermittently emits each idea
//      with the signals-vocabulary `body` instead of the required
//      `description`, plus an invented `difficulty` instead of `dev_time`. On
//      2026-06-03 all 7 ideas came back this way, EditorialSchema rejected
//      every one, and the run aborted after a 42-minute / $3.92 synthesis.
//      `description` is promoted from `body` and `difficulty` relocated to
//      `dev_time`; an idea with no salvageable description is dropped, not
//      fatal. (06-01 and 06-02 used `description` correctly — drift, not a
//      deterministic prompt break, so repair beats re-prompt.)
//
// Pure and in-place: mutates `editorial.signals.{predictions,prediction_updates}`
// and `editorial.ideation.{general,work}`, returning a stats object. No fs
// access, so it is unit-testable; scripts/synthesize.sh wires in the file I/O.

const VALID_STATUS = new Set(['pending', 'resolved-yes', 'resolved-no', 'unverifiable']);

/**
 * @param {object} editorial  parsed editorial.json (mutated in place)
 * @returns {{statusCoerced: number, dropped: number, ideationCoerced: number}}
 */
export function repairEditorial(editorial) {
  const stats = { statusCoerced: 0, dropped: 0, ideationCoerced: 0 };

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

  // Ideation field drift (2026-06-03): promote the signals-vocabulary `body`
  // to the required `description`, relocate an invented `difficulty` to
  // `dev_time`, and drop an idea only when no description can be salvaged —
  // the same repair-don't-abort stance as the prediction passes above.
  const ideation = editorial?.ideation;
  if (ideation && typeof ideation === 'object') {
    for (const key of ['general', 'work']) {
      const list = ideation[key];
      if (!Array.isArray(list)) continue;

      const out = [];
      for (const idea of list) {
        if (!idea || typeof idea !== 'object') continue;
        let next = idea;
        let touched = false;

        if (typeof next.description !== 'string' && typeof next.body === 'string') {
          next = { ...idea };
          next.description = next.body;
          delete next.body;
          touched = true;
        }

        if (typeof next.difficulty === 'string') {
          if (next === idea) next = { ...idea };
          if (typeof next.dev_time !== 'string') next.dev_time = next.difficulty;
          delete next.difficulty;
          touched = true;
        }

        if (touched) stats.ideationCoerced++;

        // No salvageable description — drop the single idea, never abort.
        if (typeof next.description !== 'string') {
          stats.dropped++;
          continue;
        }

        out.push(next);
      }
      ideation[key] = out;
    }
  }

  return stats;
}
