import { describe, expect, it } from 'vitest';
import { CURATE_SECTIONS, getStage, STAGES, topoOrder } from '../src/pipeline/stages.js';

describe('stage registry', () => {
  it('every stage has required fields with known cost/criticality', () => {
    for (const s of STAGES) {
      expect(typeof s.id).toBe('string');
      expect(Array.isArray(s.deps)).toBe(true);
      expect(['cheap', 'llm']).toContain(s.cost);
      expect(['required', 'optional']).toContain(s.criticality);
      expect(typeof s.satisfiedCheck).toBe('string');
      expect(Array.isArray(s.outputs)).toBe(true);
    }
  });

  it('declares all four curators as required (the all-required decision)', () => {
    for (const sec of CURATE_SECTIONS) {
      expect(getStage(`curate.${sec}`).criticality).toBe('required');
    }
  });

  it('every dependency references a declared stage', () => {
    const ids = new Set(STAGES.map((s) => s.id));
    for (const s of STAGES) {
      for (const d of s.deps) expect(ids.has(d)).toBe(true);
    }
  });

  it('topoOrder is acyclic and lists deps before dependents', () => {
    const order = topoOrder();
    expect(order).toHaveLength(STAGES.length);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const s of STAGES) {
      for (const d of s.deps) expect(pos.get(d)).toBeLessThan(pos.get(s.id));
    }
  });

  it('synthesize sits behind all four curators (the barrier)', () => {
    const synth = getStage('synthesize');
    for (const sec of CURATE_SECTIONS) expect(synth.deps).toContain(`curate.${sec}`);
  });

  it('merge sits behind faithfulness (audited editorial first)', () => {
    expect(getStage('merge').deps).toContain('faithfulness');
  });

  it('getStage throws on an unknown id', () => {
    expect(() => getStage('nope')).toThrow(/unknown stage/);
  });
});
