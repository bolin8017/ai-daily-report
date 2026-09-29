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

  // Reddit refuses a non-browser User-Agent (403), so its outline carries the
  // UA Miniflux must send. Feeds without the attribute stay UA-less.
  it('carries a per-feed userAgent when the outline declares one', () => {
    const feeds = parseOpml(
      '<outline text="reddit-stablediffusion" xmlUrl="https://www.reddit.com/r/StableDiffusion/.rss" category="tech" userAgent="Mozilla/5.0 (X11; Linux x86_64)"/>',
    );
    expect(feeds[0].userAgent).toBe('Mozilla/5.0 (X11; Linux x86_64)');
  });

  it('carries a per-feed blockFilterEntryRules, decoding XML entities', () => {
    const xml = [
      '<opml><body>',
      '<outline text="fv" xmlUrl="https://fv.com/feed" category="tech" blockFilterEntryRules="EntryTitle=(?i)^\\[fix\\]|a &amp; b"/>',
      '</body></opml>',
    ].join('');
    expect(parseOpml(xml)[0].blockFilterEntryRules).toBe('EntryTitle=(?i)^\\[fix\\]|a & b');
    expect(parseOpml(SAMPLE)[0].blockFilterEntryRules).toBeUndefined();
  });

  it('leaves userAgent undefined for feeds that do not need one', () => {
    expect(parseOpml(SAMPLE)[0].userAgent).toBeUndefined();
  });

  it('decodes XML entities in attributes', () => {
    const feeds = parseOpml('<outline text="x" xmlUrl="https://e.com/feed?a=1&amp;b=2"/>');
    expect(feeds[0].url).toBe('https://e.com/feed?a=1&b=2');
  });
});
