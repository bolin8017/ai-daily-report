import { describe, expect, it } from 'vitest';
import { InterestsSchema } from '../src/schemas/interests.js';

describe('InterestsSchema', () => {
  const ok = {
    rotation: { rotating_per_day: 3, seed_field: 'date' },
    interests: {
      agent: {
        level: 'core',
        label: 'AI Agent',
        github: ['agent'],
        arxiv: ['LLM agent'],
      },
      kv: {
        level: 'rotating',
        label: 'KV',
        github: ['kv-cache'],
        arxiv: [],
      },
      vc: {
        level: 'off',
        label: 'VC',
        github: ['voice-cloning'],
        arxiv: [],
      },
      vend: { level: 'rotating', label: 'Vendors', note: 'source-backed' },
    },
  };

  it('accepts a valid registry', () => {
    expect(InterestsSchema.parse(ok).interests.agent.level).toBe('core');
  });

  it('rejects an invalid level', () => {
    const bad = structuredClone(ok);
    bad.interests.agent.level = 'sometimes';
    expect(() => InterestsSchema.parse(bad)).toThrow();
  });

  it('defaults github/arxiv to empty arrays', () => {
    const parsed = InterestsSchema.parse(ok);
    expect(parsed.interests.vend.github).toEqual([]);
    expect(parsed.interests.vend.arxiv).toEqual([]);
  });
});
