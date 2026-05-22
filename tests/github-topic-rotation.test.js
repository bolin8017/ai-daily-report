import { describe, expect, it } from 'vitest';
import { selectTopicsForDate } from '../src/fetchers/providers/github-search-api.js';

describe('selectTopicsForDate', () => {
  const config = {
    enabled: true,
    tier: {
      core: ['rag', 'llm', 'agent'],
      rotating: [
        'ocr',
        'embedding',
        'voice-cloning',
        'quantization',
        'document-ai',
        'browser-automation',
      ],
    },
    rotation: { rotating_per_day: 3, rotation_seed_field: 'date' },
    limit_per_topic: 10,
  };

  it('returns core + 3 rotating per call', () => {
    const result = selectTopicsForDate(config, '2026-05-22');
    expect(result).toHaveLength(6);
    expect(result.slice(0, 3)).toEqual(['rag', 'llm', 'agent']);
  });

  it('rotates deterministically by date', () => {
    const day1 = selectTopicsForDate(config, '2026-05-22');
    const day1Again = selectTopicsForDate(config, '2026-05-22');
    const day2 = selectTopicsForDate(config, '2026-05-23');
    expect(day1).toEqual(day1Again);
    expect(day1.slice(3)).not.toEqual(day2.slice(3));
  });

  it('supports legacy flat shape', () => {
    const legacy = { enabled: true, topics: ['rag', 'llm', 'agent'], limit_per_topic: 10 };
    expect(selectTopicsForDate(legacy, '2026-05-22')).toEqual(['rag', 'llm', 'agent']);
  });

  it('covers full rotating set across enough days', () => {
    const seen = new Set();
    for (let day = 1; day <= 60; day++) {
      const dStr = `2026-06-${String(day).padStart(2, '0')}`;
      for (const t of selectTopicsForDate(config, dStr).slice(3)) seen.add(t);
    }
    expect(seen.size).toBe(6);
  });
});
