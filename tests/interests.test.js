import { describe, expect, it } from 'vitest';
import { arxivKeywords, githubTopicsForDate, loadInterests } from '../src/lib/interests.js';
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

const reg = {
  rotation: { rotating_per_day: 2, seed_field: 'date' },
  interests: {
    agent: { level: 'core', label: 'A', github: ['agent', 'ai-agent'], arxiv: ['LLM agent'] },
    rag: { level: 'core', label: 'R', github: ['rag'], arxiv: ['retrieval'] },
    kv: { level: 'rotating', label: 'K', github: ['kv-cache'], arxiv: ['kv cache'] },
    moe: { level: 'rotating', label: 'M', github: ['moe-x'], arxiv: ['mixture of experts'] },
    vc: { level: 'off', label: 'V', github: ['voice-cloning'], arxiv: ['tts'] },
  },
};

// ≥3 rotating interests, rotating_per_day=1 — forces a real sampling decision
// (the `reg` fixture above has exactly 2 rotating-with-github, so it never
// actually exercises the picker).
const rotReg = {
  rotation: { rotating_per_day: 1, seed_field: 'date' },
  interests: {
    core1: { level: 'core', label: 'C', github: ['core-term'], arxiv: [] },
    r1: { level: 'rotating', label: 'R1', github: ['rot-a'], arxiv: [] },
    r2: { level: 'rotating', label: 'R2', github: ['rot-b'], arxiv: [] },
    r3: { level: 'rotating', label: 'R3', github: ['rot-c'], arxiv: [] },
  },
};

describe('interests projections', () => {
  it('githubTopicsForDate: all core terms + N sampled rotating, deduped, no off', () => {
    const t = githubTopicsForDate(reg, '2026-06-05');
    expect(t).toEqual(expect.arrayContaining(['agent', 'ai-agent', 'rag']));
    expect(t).not.toContain('voice-cloning');
    const rotatingTerms = t.filter((x) => x === 'kv-cache' || x === 'moe-x');
    expect(rotatingTerms.length).toBeGreaterThan(0);
    expect(new Set(t).size).toBe(t.length);
  });

  it('githubTopicsForDate is deterministic for a given date', () => {
    expect(githubTopicsForDate(reg, '2026-06-05')).toEqual(githubTopicsForDate(reg, '2026-06-05'));
  });

  it('githubTopicsForDate: always includes core, picks exactly rotating_per_day rotating', () => {
    const t = githubTopicsForDate(rotReg, '2026-06-05');
    expect(t).toContain('core-term');
    const picked = t.filter((x) => ['rot-a', 'rot-b', 'rot-c'].includes(x));
    expect(picked.length).toBe(1); // rotating_per_day = 1 out of 3
  });

  it('githubTopicsForDate: rotation actually varies across dates', () => {
    const seen = new Set();
    for (let d = 1; d <= 28; d++) {
      const ds = `2026-06-${String(d).padStart(2, '0')}`;
      for (const term of githubTopicsForDate(rotReg, ds)) {
        if (['rot-a', 'rot-b', 'rot-c'].includes(term)) seen.add(term);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // proves it rotates, not flaky
  });

  it('arxivKeywords: union across non-off topics, deduped', () => {
    const k = arxivKeywords(reg);
    expect(k).toEqual(
      expect.arrayContaining(['LLM agent', 'retrieval', 'kv cache', 'mixture of experts']),
    );
    expect(k).not.toContain('tts');
    expect(new Set(k).size).toBe(k.length);
  });

  it('loadInterests reads + validates the ai-builder registry', async () => {
    const reg2 = await loadInterests('ai-builder');
    expect(reg2.interests.agent.level).toBe('core');
  });
});
