// Repair known LLM-drift patterns in editorial.json before EditorialSchema
// validation, so cosmetic synthesizer variance never aborts a full daily run.
//
// Three patterns are handled:
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
//   3. Ideation field drift. The synthesizer intermittently emits each idea
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
 * @param {object} memory     parsed memory.json (read-only); memory.predictions
 *                            supplies text/resolution_date for backfill
 * @returns {{backfilled: number, statusCoerced: number, dropped: number, ideationCoerced: number}}
 */
export function repairEditorial(editorial, memory) {
  const stats = { backfilled: 0, statusCoerced: 0, dropped: 0, ideationCoerced: 0 };

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
