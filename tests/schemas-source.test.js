import { describe, expect, it } from 'vitest';
import { RegistrySchema, SourceSchema } from '../src/schemas/source.js';

describe('SourceSchema', () => {
  const valid = {
    id: 'hackernews',
    label: 'Hacker News',
    category: 'community',
    itemType: 'hn-story',
    chain: [{ provider: 'rsshub', config: { route: '/hackernews/index' } }],
  };

  it('accepts minimal valid source', () => {
    expect(SourceSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults threshold to 1', () => {
    const parsed = SourceSchema.parse(valid);
    expect(parsed.threshold).toBe(1);
  });

  it('rejects empty chain', () => {
    expect(SourceSchema.safeParse({ ...valid, chain: [] }).success).toBe(false);
  });

  it('rejects bad id format', () => {
    expect(SourceSchema.safeParse({ ...valid, id: 'Has Spaces' }).success).toBe(false);
  });

  it('RegistrySchema validates array of sources', () => {
    expect(RegistrySchema.safeParse([valid, valid]).success).toBe(true);
  });
});
