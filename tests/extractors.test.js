import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Extractors } from '../src/fetchers/providers/_extractors/index.js';

async function fixture(name) {
  return readFile(`tests/fixtures/extractors/${name}.md`, 'utf8');
}

describe('markdown extractors', () => {
  it('hn-story extracts HN front page stories', async () => {
    const md = await fixture('hn-story');
    const items = Extractors['hn-story'](md);
    expect(items.length).toBeGreaterThan(5);
    expect(items[0]).toHaveProperty('hn_id');
    expect(items[0]).toHaveProperty('title');
    expect(items[0]).toHaveProperty('url');
    expect(items[0].hn_id).toMatch(/^\d+$/);
  });

  it('rss-post extracts blog homepage entries', async () => {
    const md = await fixture('rss-post');
    const items = Extractors['rss-post'](md, {
      sourceUrl: 'https://simonwillison.net/',
      sourceName: 'simon',
    });
    expect(items.length).toBeGreaterThan(2);
    expect(items[0].source).toBe('simon');
  });

  it('repo-card extracts trending repos', async () => {
    const md = await fixture('repo-card');
    const items = Extractors['repo-card'](md);
    expect(items.length).toBeGreaterThan(3);
    expect(items[0].full_name).toMatch(/^[^/]+\/[^/]+$/);
  });

  it('hf-model extracts trending models', async () => {
    const md = await fixture('hf-model');
    const items = Extractors['hf-model'](md);
    expect(items.length).toBeGreaterThan(3);
    expect(items[0].id).toBeTruthy();
  });

  it('arxiv-paper extracts paper list', async () => {
    const md = await fixture('arxiv-paper');
    const items = Extractors['arxiv-paper'](md);
    expect(items.length).toBeGreaterThan(3);
  });

  it('mops-disclosure + leaderboard-entry are null (no jina path)', () => {
    expect(Extractors['mops-disclosure']).toBeNull();
    expect(Extractors['leaderboard-entry']).toBeNull();
  });
});
