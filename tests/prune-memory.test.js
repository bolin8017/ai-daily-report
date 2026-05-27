// Unit tests for src/lib/prune-memory.js — bounds memory.json by dropping
// only predictions that are resolved AND whose resolution_date is more than
// retainDays in the past. Everything still "live" (pending, undated,
// recently-resolved) is kept.

import { describe, expect, it } from 'vitest';
import { pruneMemory } from '../src/lib/prune-memory.js';

const TODAY = new Date('2026-05-27T00:00:00Z'); // cutoff at retainDays=60 → 2026-03-28

function mem(predictions) {
  return { schema_version: 2, predictions };
}

describe('pruneMemory', () => {
  it('drops resolved predictions whose resolution_date is older than retainDays', () => {
    const m = mem([
      { id: 'old-yes', text: 't', status: 'resolved-yes', resolution_date: '2026-01-01' },
      { id: 'old-no', text: 't', status: 'resolved-no', resolution_date: '2026-02-15' },
      { id: 'old-unver', text: 't', status: 'unverifiable', resolution_date: '2026-03-01' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.prunedPredictions).toBe(3);
    expect(m.predictions).toHaveLength(0);
  });

  it('keeps all pending predictions regardless of age', () => {
    const m = mem([
      { id: 'p-future', text: 't', status: 'pending', resolution_date: '2026-12-31' },
      { id: 'p-overdue', text: 't', status: 'pending', resolution_date: '2025-01-01' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.prunedPredictions).toBe(0);
    expect(m.predictions).toHaveLength(2);
  });

  it('keeps recently-resolved predictions (within retainDays)', () => {
    const m = mem([
      { id: 'recent', text: 't', status: 'resolved-yes', resolution_date: '2026-05-01' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.prunedPredictions).toBe(0);
    expect(m.predictions).toHaveLength(1);
  });

  it('keeps resolved predictions with missing or unparseable resolution_date', () => {
    const m = mem([
      { id: 'no-date', text: 't', status: 'resolved-yes' },
      { id: 'bad-date', text: 't', status: 'resolved-no', resolution_date: 'someday' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.prunedPredictions).toBe(0);
    expect(m.predictions).toHaveLength(2);
  });

  it('mixed set: prunes only the resolved-and-old ones', () => {
    const m = mem([
      { id: 'keep-pending', text: 't', status: 'pending', resolution_date: '2026-12-31' },
      { id: 'drop-old', text: 't', status: 'resolved-yes', resolution_date: '2026-01-01' },
      { id: 'keep-recent', text: 't', status: 'unverifiable', resolution_date: '2026-05-20' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.prunedPredictions).toBe(1);
    expect(stats.keptPredictions).toBe(2);
    expect(m.predictions.map((p) => p.id)).toEqual(['keep-pending', 'keep-recent']);
  });

  it('is idempotent — a second pass removes nothing more', () => {
    const m = mem([
      { id: 'drop-old', text: 't', status: 'resolved-yes', resolution_date: '2026-01-01' },
      { id: 'keep', text: 't', status: 'pending', resolution_date: '2026-12-31' },
    ]);
    pruneMemory(m, { today: TODAY, retainDays: 60 });
    const second = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(second.prunedPredictions).toBe(0);
    expect(m.predictions).toHaveLength(1);
  });

  it('tolerates missing/!array predictions and junk entries', () => {
    expect(pruneMemory({}, { today: TODAY }).prunedPredictions).toBe(0);
    const m = mem([null, 'x', { id: 'ok', text: 't', status: 'pending' }]);
    const stats = pruneMemory(m, { today: TODAY });
    expect(stats.prunedPredictions).toBe(0);
    expect(m.predictions).toHaveLength(3); // junk kept, not our job to drop
  });
});
