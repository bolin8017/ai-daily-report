// Unit tests for src/lib/repair-editorial.js — softens known synthesizer drift
// (terse / out-of-enum prediction entries, ideation field drift) before
// EditorialSchema validation so cosmetic variance never aborts a full daily run.
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
    ideation: {
      general: [{ audience: 'general', title: 't', description: 'd' }],
      work: [{ audience: 'work', title: 't', description: 'd' }],
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

// Regression guard for 2026-06-03: every ideation idea was emitted with the
// signals-vocabulary `body` (+ an invented `difficulty`) instead of the
// schema-required `description`, EditorialSchema rejected all 7 ideas at the
// Stage 3 gate, and the run aborted before any report was written — wasting a
// 42-minute / $3.92 synthesis. The synthesizer drifts intermittently (the
// 06-01 and 06-02 reports used `description` correctly), so repair rather than
// re-prompt is the durable fix, mirroring the prediction_updates safety net.
describe('repairEditorial — ideation field drift', () => {
  it('promotes the signals-vocabulary `body` to the required `description`', () => {
    const ed = baseEditorial();
    ed.ideation.general = [
      { audience: 'general', title: 't1', body: 'the real idea text', source_links: ['x'] },
    ];
    const stats = repairEditorial(ed);
    expect(stats.ideationCoerced).toBe(1);
    const idea = ed.ideation.general[0];
    expect(idea.description).toBe('the real idea text');
    expect(idea.body).toBeUndefined();
    // The exact gate that aborted the 2026-06-03 run must now pass.
    expect(() => EditorialSchema.parse(ed)).not.toThrow();
  });

  it('relocates the invented `difficulty` field to the schema field `dev_time`', () => {
    const ed = baseEditorial();
    ed.ideation.work = [{ audience: 'work', title: 't', description: 'd', difficulty: 'week' }];
    const stats = repairEditorial(ed);
    expect(stats.ideationCoerced).toBe(1);
    const idea = ed.ideation.work[0];
    expect(idea.dev_time).toBe('week');
    expect(idea.difficulty).toBeUndefined();
  });

  it('does not let a stray `body` clobber an already-valid `description`', () => {
    const ed = baseEditorial();
    ed.ideation.general = [{ audience: 'general', title: 't', description: 'real', body: 'stray' }];
    const stats = repairEditorial(ed);
    expect(stats.ideationCoerced).toBe(0);
    expect(ed.ideation.general[0].description).toBe('real');
  });

  it('keeps an existing `dev_time` rather than overwriting it from `difficulty`', () => {
    const ed = baseEditorial();
    ed.ideation.work = [
      { audience: 'work', title: 't', description: 'd', dev_time: '2 days', difficulty: 'week' },
    ];
    repairEditorial(ed);
    const idea = ed.ideation.work[0];
    expect(idea.dev_time).toBe('2 days');
    expect(idea.difficulty).toBeUndefined();
  });

  it('drops an idea with no salvageable description rather than aborting the run', () => {
    const ed = baseEditorial();
    ed.ideation.general = [
      { audience: 'general', title: 'only a title' },
      { audience: 'general', title: 't2', description: 'keeper' },
    ];
    const stats = repairEditorial(ed);
    expect(stats.dropped).toBe(1);
    expect(ed.ideation.general).toHaveLength(1);
    expect(ed.ideation.general[0].description).toBe('keeper');
    expect(() => EditorialSchema.parse(ed)).not.toThrow();
  });

  it('leaves already-valid ideation untouched', () => {
    const ed = baseEditorial();
    const stats = repairEditorial(ed);
    expect(stats.ideationCoerced).toBe(0);
    expect(stats.dropped).toBe(0);
    expect(ed.ideation.general[0].description).toBe('d');
    expect(ed.ideation.work[0].description).toBe('d');
  });
});
