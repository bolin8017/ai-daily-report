import { describe, expect, it } from 'vitest';
import { compareFeedCounts } from '../src/lib/miniflux-shadow.js';

describe('compareFeedCounts', () => {
  it('reports per-source counts for chains vs miniflux and the delta', () => {
    const chainItems = [
      { source: 'simon-willison' },
      { source: 'simon-willison' },
      { source: 'stratechery' },
    ];
    const minifluxItems = [{ source: 'simon-willison' }, { source: 'lwn' }];
    const cmp = compareFeedCounts(chainItems, minifluxItems);
    expect(cmp.bySource['simon-willison']).toEqual({ chain: 2, miniflux: 1 });
    expect(cmp.bySource.stratechery).toEqual({ chain: 1, miniflux: 0 });
    expect(cmp.bySource.lwn).toEqual({ chain: 0, miniflux: 1 });
    expect(cmp.totals).toEqual({ chain: 3, miniflux: 2 });
    expect(cmp.onlyInChain).toEqual(['stratechery']);
    expect(cmp.onlyInMiniflux).toEqual(['lwn']);
  });

  it('handles empty inputs', () => {
    const cmp = compareFeedCounts([], []);
    expect(cmp.totals).toEqual({ chain: 0, miniflux: 0 });
    expect(cmp.bySource).toEqual({});
    expect(cmp.onlyInChain).toEqual([]);
    expect(cmp.onlyInMiniflux).toEqual([]);
  });
});
