import { describe, expect, it } from 'vitest';
import { ItemSchemas } from '../src/schemas/items/index.js';
import { ShippedItem } from '../src/schemas/items.js';

describe('ItemSchemas registry', () => {
  it('exposes all 7 itemTypes', () => {
    expect(Object.keys(ItemSchemas).sort()).toEqual([
      'arxiv-paper',
      'hf-model',
      'hn-story',
      'leaderboard-entry',
      'mops-disclosure',
      'repo-card',
      'rss-post',
    ]);
  });

  it('hn-story accepts a minimal valid story', () => {
    const item = {
      source: 'hackernews',
      title: 'Show HN: thing',
      url: 'https://example.com/x',
      hn_url: 'https://news.ycombinator.com/item?id=1',
      hn_id: '1',
      author: 'pg',
      published: '2026-05-22T00:00:00Z',
      rank: 1,
    };
    expect(ItemSchemas['hn-story'].safeParse(item).success).toBe(true);
  });

  it('hn-story rejects missing hn_id', () => {
    const item = {
      source: 'hackernews',
      title: 'x',
      url: 'https://x.test',
      hn_url: 'https://news.ycombinator.com/item?id=1',
      author: '',
      published: null,
      rank: 1,
    };
    expect(ItemSchemas['hn-story'].safeParse(item).success).toBe(false);
  });

  it('rss-post accepts minimal post', () => {
    expect(
      ItemSchemas['rss-post'].safeParse({
        source: 'simon-willison',
        category: 'AI 部落格',
        title: 't',
        url: 'https://x.test',
        published: null,
        rank: 1,
      }).success,
    ).toBe(true);
  });

  it('mops-disclosure accepts row with ticker + headline', () => {
    expect(
      ItemSchemas['mops-disclosure'].safeParse({
        ticker: '8299',
        ticker_name: '群聯',
        disclosure_date: '2026-05-22',
        statement_date: '2026-05-22',
        statement_time: '15:00',
        headline: '訊息',
        basis: null,
        fact_date: null,
        detail: '',
        url: 'https://mops.twse.com.tw/mops/web/t05st01?co_id=8299',
      }).success,
    ).toBe(true);
  });
});

describe('ShippedItem.stars_today', () => {
  it('accepts a numeric or null stars_today', () => {
    expect(() => ShippedItem.parse({ id: 'x', name: 'a/b', stars_today: 1531 })).not.toThrow();
    expect(() => ShippedItem.parse({ id: 'x', name: 'a/b', stars_today: null })).not.toThrow();
  });
  it('rejects a non-numeric stars_today', () => {
    expect(() => ShippedItem.parse({ id: 'x', name: 'a/b', stars_today: 'lots' })).toThrow();
  });
});
