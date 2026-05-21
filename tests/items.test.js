import { describe, expect, it } from 'vitest';
import {
  AudienceTag,
  IdeaItem,
  ItemBase,
  MarketItem,
  PredictionItem,
  PulseItem,
  ShippedItem,
  SignalItem,
  TechItem,
} from '../src/schemas/items.js';

describe('AudienceTag', () => {
  it('accepts general / work / both', () => {
    expect(AudienceTag.parse('general')).toBe('general');
    expect(AudienceTag.parse('work')).toBe('work');
    expect(AudienceTag.parse('both')).toBe('both');
  });
  it('rejects other values', () => {
    expect(() => AudienceTag.parse('other')).toThrow();
  });
});

describe('ItemBase', () => {
  it('requires id; defaults audience to general', () => {
    const parsed = ItemBase.parse({ id: 'shipped.trending.0:foo/bar' });
    expect(parsed.id).toBe('shipped.trending.0:foo/bar');
    expect(parsed.audience).toBe('general');
  });
  it('accepts unknown auxiliary fields via passthrough', () => {
    const parsed = ItemBase.parse({ id: 'x', extra: 'hello' });
    expect(parsed.extra).toBe('hello');
  });
  it('rejects missing id', () => {
    expect(() => ItemBase.parse({})).toThrow();
  });
});

describe('ShippedItem', () => {
  it('parses a minimal shipped item', () => {
    const parsed = ShippedItem.parse({
      id: 'shipped.trending.0:vllm-project/vllm',
      name: 'vllm',
    });
    expect(parsed.name).toBe('vllm');
    expect(parsed.audience).toBe('general');
  });
});

describe('PulseItem', () => {
  it('parses a minimal pulse item', () => {
    const parsed = PulseItem.parse({
      id: 'pulse.hn.0:hn-1',
      title: 'Show HN: foo',
    });
    expect(parsed.title).toBe('Show HN: foo');
  });
});

describe('MarketItem', () => {
  it('parses companies array', () => {
    const parsed = MarketItem.parse({
      id: 'market.ma.0:reuters-abc',
      title: 'AcquiHire',
      companies: ['Anthropic', 'Stripe'],
    });
    expect(parsed.companies).toEqual(['Anthropic', 'Stripe']);
  });
});

describe('TechItem', () => {
  it('parses benchmark_changes nested', () => {
    const parsed = TechItem.parse({
      id: 'tech.benchmarks.0:mteb-foo',
      title: 'MTEB rank shift',
      benchmark_changes: { new_top_5: ['foo'], rank_changes: ['bar: #5→#2'] },
    });
    expect(parsed.benchmark_changes.new_top_5).toEqual(['foo']);
  });
});

describe('IdeaItem', () => {
  it('requires audience explicitly', () => {
    expect(() => IdeaItem.parse({ id: 'x', title: 't', description: 'd' })).toThrow();
  });
  it('accepts source_links array', () => {
    const parsed = IdeaItem.parse({
      id: 'idea-1',
      audience: 'work',
      title: 'test',
      description: 'd',
      source_links: ['shipped.trending.0:vllm-project/vllm'],
    });
    expect(parsed.source_links).toEqual(['shipped.trending.0:vllm-project/vllm']);
  });
});

describe('SignalItem', () => {
  it('accepts mechanism + product_opportunity', () => {
    const parsed = SignalItem.parse({
      id: 'signals.focus.0',
      title: 'X happens',
      mechanism: 'because Y',
      product_opportunity: 'build Z',
    });
    expect(parsed.mechanism).toBe('because Y');
  });
});

describe('PredictionItem', () => {
  it('requires resolution_date', () => {
    expect(() => PredictionItem.parse({ id: 'p1', text: 'x will happen' })).toThrow();
  });
  it('defaults status to pending', () => {
    const parsed = PredictionItem.parse({
      id: 'p1',
      text: 'x will happen',
      resolution_date: '2026-12-31',
    });
    expect(parsed.status).toBe('pending');
  });
});
