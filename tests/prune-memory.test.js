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

  it('keeps pending predictions that are not yet past graceDays', () => {
    const m = mem([
      { id: 'p-future', text: 't', status: 'pending', resolution_date: '2026-12-31' },
      { id: 'p-recent', text: 't', status: 'pending', resolution_date: '2026-05-20' }, // 7d before TODAY, within grace 30
      { id: 'p-undated', text: 't', status: 'pending' }, // no resolution_date → never expired
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60, graceDays: 30 });
    expect(stats.prunedPredictions).toBe(0);
    expect(stats.expiredPending).toBe(0);
    expect(m.predictions).toHaveLength(3);
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

  it('expires overdue pending to unverifiable and keeps it (past grace, within retain)', () => {
    // 2026-04-15 is 42 days before TODAY (2026-05-27): past grace(30) so expired,
    // but within retain(60) so NOT yet dropped — the flip-but-keep path.
    const m = mem([
      { id: 'overdue', text: 't', status: 'pending', resolution_date: '2026-04-15' },
      { id: 'future', text: 't', status: 'pending', resolution_date: '2026-12-31' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60, graceDays: 30 });
    expect(stats.expiredPending).toBe(1);
    expect(stats.prunedPredictions).toBe(0);
    const overdue = m.predictions.find((p) => p.id === 'overdue');
    expect(overdue.status).toBe('unverifiable');
    expect(overdue.auto_expired).toBe(true);
    const future = m.predictions.find((p) => p.id === 'future');
    expect(future.status).toBe('pending');
  });

  it('expired-then-old pending is dropped in the same pass once past retainDays', () => {
    // overdue (grace) AND resolution_date > retainDays past → flipped then dropped same call
    const m = mem([{ id: 'ancient', text: 't', status: 'pending', resolution_date: '2026-01-01' }]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60, graceDays: 30 });
    expect(stats.expiredPending).toBe(1);
    expect(stats.prunedPredictions).toBe(1);
    expect(m.predictions).toHaveLength(0);
  });

  it('does not expire pending that is overdue by less than graceDays', () => {
    // resolution_date 2026-05-20 is 7 days before TODAY; grace=30 → still within grace
    const m = mem([
      { id: 'recent-overdue', text: 't', status: 'pending', resolution_date: '2026-05-20' },
    ]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60, graceDays: 30 });
    expect(stats.expiredPending).toBe(0);
    expect(m.predictions[0].status).toBe('pending');
  });

  it('defaults graceDays to 30 when not provided', () => {
    const m = mem([{ id: 'overdue', text: 't', status: 'pending', resolution_date: '2026-03-01' }]);
    const stats = pruneMemory(m, { today: TODAY, retainDays: 60 });
    expect(stats.expiredPending).toBe(1);
  });
});
