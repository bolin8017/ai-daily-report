import { describe, expect, it } from 'vitest';
import { mergeSources } from '../src/lib/sources.js';

describe('mergeSources', () => {
  const base = [
    {
      id: 'a',
      label: 'A',
      category: 'x',
      itemType: 'rss-post',
      chain: [{ provider: 'p', config: {} }],
    },
    {
      id: 'b',
      label: 'B',
      category: 'x',
      itemType: 'rss-post',
      chain: [{ provider: 'p', config: {} }],
    },
  ];

  it('returns base when overlay is empty', () => {
    expect(mergeSources(base, [])).toEqual(base);
  });

  it('appends new sources from overlay', () => {
    const overlay = [
      {
        id: 'c',
        label: 'C',
        category: 'x',
        itemType: 'rss-post',
        chain: [{ provider: 'p', config: {} }],
      },
    ];
    const result = mergeSources(base, overlay);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('overrides by id when overlay entry shares an id', () => {
    const overlay = [
      {
        id: 'a',
        label: 'A-override',
        category: 'y',
        itemType: 'rss-post',
        chain: [{ provider: 'q', config: {} }],
      },
    ];
    const result = mergeSources(base, overlay);
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.id === 'a').label).toBe('A-override');
  });
});
