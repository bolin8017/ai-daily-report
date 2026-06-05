import { describe, expect, it } from 'vitest';
import {
  MarketCuratedSchema,
  PulseCuratedSchema,
  ShippedCuratedSchema,
  TechCuratedSchema,
} from '../src/schemas/curated.js';

describe('Curated sub-schemas', () => {
  it('ShippedCuratedSchema parses 4 sub-groups', () => {
    const parsed = ShippedCuratedSchema.parse({
      trending: [{ id: 'shipped.trending.0:vllm-project/vllm', name: 'vllm' }],
      topic_discovery: [],
      dev_watch_taiwan: [],
      dev_watch_global: [],
    });
    expect(parsed.trending).toHaveLength(1);
  });

  it('PulseCuratedSchema parses 4 sub-groups', () => {
    const parsed = PulseCuratedSchema.parse({
      hn: [{ id: 'pulse.hn.0:hn-1', title: 'foo' }],
      lobsters: [],
      chinese_community: [],
      ai_bloggers: [],
    });
    expect(parsed.hn).toHaveLength(1);
  });

  it('MarketCuratedSchema parses 3 sub-groups', () => {
    const parsed = MarketCuratedSchema.parse({
      ma: [{ id: 'market.ma.0:reuters-abc', title: 'M&A' }],
      funding: [],
      taiwan: [],
    });
    expect(parsed.ma).toHaveLength(1);
  });

  it('TechCuratedSchema parses 4 sub-groups', () => {
    const parsed = TechCuratedSchema.parse({
      vendor: [{ id: 'tech.vendor.0:anthropic-x', title: 'release' }],
      models: [],
      benchmarks: [],
      aidaptiv: [],
    });
    expect(parsed.vendor).toHaveLength(1);
  });

  it('ShippedCuratedSchema rejects missing sub-group', () => {
    expect(() =>
      ShippedCuratedSchema.parse({
        trending: [],
        topic_discovery: [],
        dev_watch_taiwan: [],
        // dev_watch_global missing
      }),
    ).toThrow();
  });
});
