import { describe, expect, it } from 'vitest';
import { resolveSearchTopics } from '../src/fetchers/providers/github-search-api.js';
import { githubTopicsForDate } from '../src/lib/interests.js';

describe('github-search topic resolution', () => {
  it('derives topics from the interest registry for a date', async () => {
    const topics = await resolveSearchTopics('2026-06-05', 'ai-builder');
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
  });
});

describe('githubTopicsForDate rotatingPerDay override', () => {
  const reg = {
    rotation: { rotating_per_day: 3 },
    interests: {
      a: { level: 'core', github: ['agent'] },
      b: { level: 'rotating', github: ['r1'] },
      c: { level: 'rotating', github: ['r2'] },
      d: { level: 'rotating', github: ['r3'] },
      e: { level: 'rotating', github: ['r4'] },
      f: { level: 'rotating', github: ['r5'] },
    },
  };
  it('defaults to reg.rotation.rotating_per_day', () => {
    expect(githubTopicsForDate(reg, '2026-06-15')).toHaveLength(1 + 3);
  });
  it('uses the override when provided', () => {
    expect(githubTopicsForDate(reg, '2026-06-15', 5)).toHaveLength(1 + 5);
  });
  it('is deterministic for a given date', () => {
    expect(githubTopicsForDate(reg, '2026-06-15', 4)).toEqual(githubTopicsForDate(reg, '2026-06-15', 4));
  });
});
