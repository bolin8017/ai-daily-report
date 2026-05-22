import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProviders,
  defineProvider,
  getProvider,
  listProviders,
} from '../src/fetchers/providers/_registry.js';

const validHNStory = {
  source: 'hackernews',
  title: 't',
  url: 'https://x.test',
  hn_url: 'https://news.ycombinator.com/item?id=1',
  hn_id: '1',
  author: '',
  published: null,
  rank: 1,
};

describe('provider registry', () => {
  beforeEach(() => clearProviders());

  it('defineProvider registers a name', () => {
    defineProvider('fake-test-1', async () => ({ ok: true, items: [] }));
    expect(listProviders()).toContain('fake-test-1');
  });

  it('wrapped provider validates items against itemType', async () => {
    defineProvider('fake-test-2', async () => ({ ok: true, items: [validHNStory] }));
    const result = await getProvider('fake-test-2')(
      {},
      { itemType: 'hn-story', sourceId: 'x' },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('wrapped provider filters invalid items', async () => {
    defineProvider('fake-test-3', async () => ({
      ok: true,
      items: [validHNStory, { source: 'hackernews' }],
    }));
    const result = await getProvider('fake-test-3')(
      {},
      { itemType: 'hn-story', sourceId: 'x' },
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('wrapped provider returns ok:false when ALL items fail validation', async () => {
    defineProvider('fake-test-4', async () => ({
      ok: true,
      items: [{ source: 'hackernews' }, { source: 'hackernews' }],
    }));
    const result = await getProvider('fake-test-4')(
      {},
      { itemType: 'hn-story', sourceId: 'x' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/validation/);
  });

  it('wrapped provider catches thrown errors', async () => {
    defineProvider('fake-test-5', async () => {
      throw new Error('boom');
    });
    const result = await getProvider('fake-test-5')(
      {},
      { itemType: 'hn-story', sourceId: 'x' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('getProvider throws on unknown name', () => {
    expect(() => getProvider('does-not-exist')).toThrow(/unknown provider/);
  });
});
