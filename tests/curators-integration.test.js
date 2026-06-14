import { describe, expect, it } from 'vitest';
import { validate as validateDiscoveries } from '../src/curators/discoveries.js';

// End-to-end check of the discoveries (新發現) curator orchestrator's validate(),
// which the live pipeline runs over the curator's Write output. Replaced the
// retired shipped curator's integration test on the 2026-06-15 tab cutover.
describe('Curator validate end-to-end', () => {
  const goodFixture = {
    rising: [
      {
        id: 'discoveries.rising.0:vllm-project/vllm',
        name: 'vllm-project/vllm',
        url: 'https://github.com/vllm-project/vllm',
        stars: 1200,
        language: 'Python',
        novelty_strength: 3,
        relevance: '高吞吐推論引擎，崛起中。',
        audience: 'both',
      },
    ],
    dev_watch: [],
  };

  it('discoveries curator validates a known-good fixture', () => {
    const parsed = validateDiscoveries(goodFixture);
    expect(parsed.rising[0].id).toBe('discoveries.rising.0:vllm-project/vllm');
    expect(parsed.rising[0].audience).toBe('both');
  });

  it('discoveries curator rejects bad shape', () => {
    expect(() => validateDiscoveries({ rising: 'not-an-array', dev_watch: [] })).toThrow(/rising/);
  });

  it('discoveries curator rejects an item missing required name', () => {
    expect(() => validateDiscoveries({ rising: [{ id: 'x' }], dev_watch: [] })).toThrow();
  });
});
