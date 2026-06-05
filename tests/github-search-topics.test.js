import { describe, expect, it } from 'vitest';
import { resolveSearchTopics } from '../src/fetchers/providers/github-search-api.js';

describe('github-search topic resolution', () => {
  it('derives topics from the interest registry for a date', async () => {
    const topics = await resolveSearchTopics('2026-06-05', 'ai-builder');
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
  });
});
