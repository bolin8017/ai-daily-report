// Unit tests for src/lib/repair-editorial.js — softens known synthesizer drift
// (terse / out-of-enum prediction entries) before EditorialSchema validation so
// cosmetic variance never aborts a full daily run.
//
// Cross-day memory was retired with the Hermes Wiki migration, so a terse
// {id, status} prediction_update can no longer be backfilled — it is dropped
// (one entry, never the whole run) rather than reaching the schema gate. The
// 2026-05-27 run aborted when 43/43 such updates hit EditorialSchema unrepaired.

import { describe, expect, it } from 'vitest';
import { repairEditorial } from '../src/lib/repair-editorial.js';
import { EditorialSchema } from '../src/schemas/editorial.js';

function baseEditorial(signalsOverride = {}) {
  return {
    schema_version: '2.1-editorial',
    date: '2026-05-27',
    theme: 'ai-builder',
    lead: { html: '<p>lead</p>' },
    signals: {
      focus: [{ id: 'sig.focus.0', title: 's', body: 'b', audience: 'general' }],
      predictions: [
        {
          id: 'pred-new',
          text: 'a fresh prediction',
          resolution_date: '2026-12-31',
          status: 'pending',
        },
      ],
      prediction_updates: [],
      ...signalsOverride,
    },
  };
}

describe('repairEditorial', () => {
  it('drops terse {id,status} prediction_updates now that memory backfill is retired', () => {
    const ed = baseEditorial({
      prediction_updates: [
        { id: 'pred-a', status: 'resolved-yes' },
        { id: 'pred-b', status: 'pending' },
      ],
    });
    const stats = repairEditorial(ed);
    expect(stats.dropped).toBe(2);
    expect(ed.signals.prediction_updates).toHaveLength(0);
    // The repaired doc must still pass EditorialSchema — this is the exact gate
    // that aborted the 2026-05-27 run when terse updates reached it unrepaired.
    expect(() => EditorialSchema.parse(ed)).not.toThrow();
  });

  it('coerces an unknown status enum to unverifiable on an otherwise-complete entry', () => {
    const ed = baseEditorial({
      prediction_updates: [
        {
          id: 'pred-a',
          text: 'A happens by date',
          resolution_date: '2026-09-30',
          status: 'needs_revision',
        },
      ],
    });
    const stats = repairEditorial(ed);
    expect(stats.statusCoerced).toBe(1);
    expect(ed.signals.prediction_updates[0].status).toBe('unverifiable');
  });

  it('drops an entry missing text/resolution_date rather than aborting the run', () => {
    const ed = baseEditorial({ prediction_updates: [{ id: 'ghost', status: 'pending' }] });
    const stats = repairEditorial(ed);
    expect(stats.dropped).toBe(1);
    expect(ed.signals.prediction_updates).toHaveLength(0);
  });

  it('leaves a complete entry untouched (idempotent — no clobber of LLM text)', () => {
    const ed = baseEditorial({
      prediction_updates: [
        {
          id: 'pred-a',
          text: 'kept text',
          resolution_date: '2026-09-30',
          status: 'pending',
        },
      ],
    });
    const stats = repairEditorial(ed);
    expect(stats.dropped).toBe(0);
    expect(stats.statusCoerced).toBe(0);
    expect(ed.signals.prediction_updates[0].text).toBe('kept text');
  });
});
