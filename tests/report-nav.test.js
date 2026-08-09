import { describe, expect, it } from 'vitest';
import { groupByMonth, neighborsOf, selectSwitchable } from '../src/lib/report-nav.js';

const current = (date) => ({ date, discoveries: { rising: [], dev_watch: [] } });
const legacy = (date) => ({ date, catalog: [], shipped: {} });

describe('selectSwitchable', () => {
  it('drops reports that have no discoveries section', () => {
    const out = selectSwitchable([current('2026-08-09'), legacy('2026-06-10')]);
    expect(out.map((r) => r.date)).toEqual(['2026-08-09']);
  });

  // A day the funnel found nothing on still renders the current layout, so a
  // reader can switch to it. Presence of the key is the line, not its content.
  it('keeps a day whose discoveries section found nothing', () => {
    const out = selectSwitchable([
      { date: '2026-08-09', discoveries: { rising: [], dev_watch: [] } },
    ]);
    expect(out).toHaveLength(1);
  });

  it('sorts newest first regardless of input order', () => {
    const out = selectSwitchable([
      current('2026-07-01'),
      current('2026-08-09'),
      current('2026-06-15'),
    ]);
    expect(out.map((r) => r.date)).toEqual(['2026-08-09', '2026-07-01', '2026-06-15']);
  });
});

describe('neighborsOf', () => {
  const list = selectSwitchable([
    current('2026-08-09'),
    current('2026-08-08'),
    current('2026-08-07'),
  ]);

  it('returns the older day as prev and the newer as next', () => {
    const { prev, next } = neighborsOf(list, '2026-08-08');
    expect(prev.date).toBe('2026-08-07');
    expect(next.date).toBe('2026-08-09');
  });

  it('has no next at the newest entry', () => {
    const { prev, next } = neighborsOf(list, '2026-08-09');
    expect(next).toBeNull();
    expect(prev.date).toBe('2026-08-08');
  });

  it('has no prev at the oldest entry', () => {
    const { prev, next } = neighborsOf(list, '2026-08-07');
    expect(prev).toBeNull();
    expect(next.date).toBe('2026-08-08');
  });

  // A pre-cutover archive page: still readable at its URL, absent from the
  // switcher, so it renders no arrows rather than wrong ones.
  it('returns both null for a date outside the list', () => {
    expect(neighborsOf(list, '2026-06-10')).toEqual({ prev: null, next: null });
  });
});

describe('groupByMonth', () => {
  it('opens a new bucket at a month boundary', () => {
    const out = groupByMonth(
      selectSwitchable([current('2026-08-01'), current('2026-07-31'), current('2026-08-02')]),
    );
    expect(out.map((g) => g.month)).toEqual(['2026-08', '2026-07']);
    expect(out[0].days.map((d) => d.day)).toEqual(['02', '01']);
    expect(out[1].days.map((d) => d.date)).toEqual(['2026-07-31']);
  });

  it('returns an empty array for an empty list', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
