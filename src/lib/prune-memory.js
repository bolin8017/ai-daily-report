// Bound memory.json growth by dropping predictions that have outlived their
// usefulness. `signals.prediction_updates` echoes one entry per memory
// prediction, so an ever-growing predictions list bloats both memory.json and
// the daily editorial (and was the proximate cause of the 2026-05-27 synthesis
// failure — see src/lib/repair-editorial.js). Predictions accumulate ~5-7/day
// and nothing ever removed them.
//
// Retention policy is deliberately conservative — it never drops anything
// still "live":
//   - keep `pending` predictions that are not yet past graceDays (active bets)
//   - expire overdue pending (resolution_date > graceDays past) to
//     `unverifiable` + stamp `auto_expired`, then age out via the drop rule —
//     the synthesizer has a 0% historical resolution rate, so without this
//     pending accumulates forever and the resolved-drop never fires
//   - keep anything without a parseable `resolution_date`
//   - keep recently-resolved predictions (resolution_date within retainDays)
//   - drop ONLY predictions that are resolved (resolved-yes/-no/unverifiable)
//     AND whose resolution_date is more than retainDays in the past
//
// Pure and in-place: mutates `memory.predictions` and returns a stats object.

const RESOLVED = new Set(['resolved-yes', 'resolved-no', 'unverifiable']);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} memory  parsed memory.json (mutated in place)
 * @param {object} [opts]
 * @param {Date}   [opts.today]       reference "now" (default: new Date())
 * @param {number} [opts.retainDays]  keep resolved predictions this many days
 *                                    past their resolution_date (default: 60,
 *                                    matching the report hot window)
 * @returns {{prunedPredictions: number, keptPredictions: number}}
 */
export function pruneMemory(memory, { today = new Date(), retainDays = 60, graceDays = 30 } = {}) {
  const stats = { prunedPredictions: 0, keptPredictions: 0, expiredPending: 0 };

  const preds = memory?.predictions;
  if (!Array.isArray(preds)) return stats;

  const nowMs = today.getTime();
  const graceCutoffMs = nowMs - graceDays * DAY_MS;
  const retainCutoffMs = nowMs - retainDays * DAY_MS;
  const kept = [];
  for (const p of preds) {
    if (p && typeof p === 'object') {
      // Expiry: an overdue, never-scored pending bet becomes unverifiable so it
      // can age out — the synthesizer has never resolved one, so without this
      // pending accumulates without bound (the bloat behind the 2026-05-27 abort).
      if (p.status === 'pending') {
        const rdMs =
          typeof p.resolution_date === 'string' ? Date.parse(p.resolution_date) : Number.NaN;
        if (!Number.isNaN(rdMs) && rdMs < graceCutoffMs) {
          p.status = 'unverifiable';
          p.auto_expired = true;
          stats.expiredPending++;
        }
      }

      // Drop: resolved (incl. just-expired) AND resolution_date > retainDays past.
      const resolved = typeof p.status === 'string' && RESOLVED.has(p.status);
      const rdMs =
        typeof p.resolution_date === 'string' ? Date.parse(p.resolution_date) : Number.NaN;
      if (resolved && !Number.isNaN(rdMs) && rdMs < retainCutoffMs) {
        stats.prunedPredictions++;
        continue;
      }
    }
    kept.push(p);
  }

  memory.predictions = kept;
  stats.keptPredictions = kept.length;
  return stats;
}
