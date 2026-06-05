import { describe, expect, it } from 'vitest';
import { parseOpml } from '../src/lib/feeds-opml.js';

const SAMPLE = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="simon-willison" title="Simon Willison" type="rss" xmlUrl="https://simonwillison.net/atom/everything/" category="tech"/>
  <outline text="stratechery" title="Stratechery" type="rss" xmlUrl="https://stratechery.com/feed" category="market"/>
  <outline text="cat-only" title="Container"/>
</body></opml>`;

describe('parseOpml', () => {
  it('parses outlines that have xmlUrl, skips container outlines', () => {
    const feeds = parseOpml(SAMPLE);
    expect(feeds).toHaveLength(2);
    expect(feeds[0]).toEqual({
      id: 'simon-willison',
      label: 'Simon Willison',
      url: 'https://simonwillison.net/atom/everything/',
      category: 'tech',
    });
  });

  it('decodes XML entities in attributes', () => {
    const feeds = parseOpml('<outline text="x" xmlUrl="https://e.com/feed?a=1&amp;b=2"/>');
    expect(feeds[0].url).toBe('https://e.com/feed?a=1&b=2');
  });
});
