// Unit tests for src/lib/source-dates.js — the url→published map captured in
// collect.js before condense drops date fields, so the Stage 3.5 guard can date
// sources whose URL has no parseable date (substack /p/, blog, vendor PR).

import { describe, expect, it } from 'vitest';
import { buildSourceDateMap, computeAges } from '../src/lib/source-dates.js';

describe('buildSourceDateMap', () => {
  it('maps a feed item url → ISO date from published / isoDate / pubDate', () => {
    const raw = {
      feeds: {
        items: [
          {
            url: 'https://magazine.sebastianraschka.com/p/recent-developments',
            published: '2026-05-16T08:00:00Z',
          },
          { url: 'https://hamel.dev/blog/posts/revenge/', isoDate: '2026-01-15T00:00:00.000Z' },
          { url: 'https://news.samsung.com/global/hbm4e', pubDate: '2026-05-30' },
        ],
      },
    };
    const map = buildSourceDateMap(raw);
    expect(map['https://magazine.sebastianraschka.com/p/recent-developments']).toBe('2026-05-16');
    expect(map['https://hamel.dev/blog/posts/revenge/']).toBe('2026-01-15');
    expect(map['https://news.samsung.com/global/hbm4e']).toBe('2026-05-30');
  });

  it('skips items with no url or no parseable date', () => {
    const map = buildSourceDateMap({
      feeds: {
        items: [
          { url: 'https://x.com/a', published: null },
          { published: '2026-05-16' }, // no url
          { url: 'https://x.com/b' }, // no date
        ],
      },
    });
    expect(map).toEqual({});
  });

  it('first dated writer wins for a duplicate url', () => {
    const map = buildSourceDateMap({
      feeds: {
        items: [
          { url: 'https://x.com/a', published: '2026-05-16' },
          { url: 'https://x.com/a', published: '2026-05-20' },
        ],
      },
    });
    expect(map['https://x.com/a']).toBe('2026-05-16');
  });

  it('tolerates empty / missing input', () => {
    expect(buildSourceDateMap()).toEqual({});
    expect(buildSourceDateMap({ feeds: null })).toEqual({});
  });
});

describe('computeAges', () => {
  it('turns url→date into url→age_days against a report date (no LLM arithmetic)', () => {
    const ages = computeAges(
      {
        'https://a': '2026-05-16',
        'https://b': '2026-05-30',
        'https://c': '2026-05-31',
      },
      '2026-05-31',
    );
    expect(ages['https://a']).toBe(15);
    expect(ages['https://b']).toBe(1);
    expect(ages['https://c']).toBe(0);
  });
  it('skips unparseable dates and tolerates empty input', () => {
    expect(computeAges({ 'https://a': 'not-a-date' }, '2026-05-31')).toEqual({});
    expect(computeAges()).toEqual({});
  });
});
