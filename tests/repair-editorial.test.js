// Unit tests for src/lib/repair-editorial.js — backfills prediction_updates
// (and predictions) entries that the synthesizer emitted as a terse
// {id, status} delta, using data/memory.json as the source of the
// schema-required text/resolution_date.
//
// Regression guard for 2026-05-27: 43/43 prediction_updates were emitted as
// {id, status} only (no text/resolution_date), EditorialSchema rejected them,
// and the entire daily run aborted at the Stage 3 validation gate — so no
// report was produced and the site went stale on the previous day.

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
    ideation: {
      general: [{ audience: 'general', title: 't', description: 'd' }],
      work: [{ audience: 'work', title: 't', description: 'd' }],
    },
  };
}

const memory = {
  schema_version: 2,
  predictions: [
    {
      id: 'pred-a',
      text: 'A happens by date',
      resolution_date: '2026-09-30',
      status: 'pending',
      created: '2026-04-14',
    },
    {
      id: 'pred-b',
      text: 'B happens by date',
      resolution_date: '2026-10-31',
      status: 'pending',
      created: '2026-04-20',
    },
  ],
};

describe('repairEditorial', () => {
  it('backfills text/resolution_date for {id,status} prediction_updates from memory', () => {
    const ed = baseEditorial({
      prediction_updates: [
        { id: 'pred-a', status: 'resolved-yes' },
        { id: 'pred-b', status: 'pending' },
      ],
    });
    const stats = repairEditorial(ed, memory);
    expect(stats.backfilled).toBe(2);
    const [a, b] = ed.signals.prediction_updates;
    expect(a).toMatchObject({
      id: 'pred-a',
      text: 'A happens by date',
      resolution_date: '2026-09-30',
      status: 'resolved-yes',
    });
    expect(b.text).toBe('B happens by date');
    // The repaired doc must now pass EditorialSchema — this is the exact gate
    // that aborted the 2026-05-27 run.
    expect(() => EditorialSchema.parse(ed)).not.toThrow();
  });

  it("the LLM's delta status overrides memory, but memory fills the missing fields", () => {
    const ed = baseEditorial({ prediction_updates: [{ id: 'pred-a', status: 'resolved-no' }] });
    repairEditorial(ed, memory);
    expect(ed.signals.prediction_updates[0].status).toBe('resolved-no');
    expect(ed.signals.prediction_updates[0].resolution_date).toBe('2026-09-30');
  });

  it('coerces an unknown status enum to unverifiable', () => {
    const ed = baseEditorial({ prediction_updates: [{ id: 'pred-a', status: 'needs_revision' }] });
    const stats = repairEditorial(ed, memory);
    expect(stats.statusCoerced).toBe(1);
    expect(ed.signals.prediction_updates[0].status).toBe('unverifiable');
  });

  it('drops an entry that has no memory match and no text/resolution_date', () => {
    const ed = baseEditorial({ prediction_updates: [{ id: 'ghost', status: 'pending' }] });
    const stats = repairEditorial(ed, memory);
    expect(stats.dropped).toBe(1);
    expect(ed.signals.prediction_updates).toHaveLength(0);
  });

  it('leaves a complete entry untouched (idempotent — no clobber of LLM text)', () => {
    const ed = baseEditorial({
      prediction_updates: [
        {
          id: 'pred-a',
          text: 'overridden text',
          resolution_date: '2026-09-30',
          status: 'pending',
          created: '2026-04-14',
        },
      ],
    });
    const stats = repairEditorial(ed, memory);
    expect(stats.backfilled).toBe(0);
    expect(ed.signals.prediction_updates[0].text).toBe('overridden text');
  });

  it('tolerates missing memory by dropping unbackfillable updates instead of throwing', () => {
    const ed = baseEditorial({ prediction_updates: [{ id: 'pred-a', status: 'pending' }] });
    const stats = repairEditorial(ed, {});
    expect(stats.dropped).toBe(1);
  });
});
