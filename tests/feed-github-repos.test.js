import { describe, expect, it } from 'vitest';
import { buildFeedRepoItems, extractRepoMentions } from '../src/lib/feed-github-repos.js';

const feed = (source, fields) => ({ source, url: '', title: '', description: '', ...fields });

describe('extractRepoMentions', () => {
  it('picks up repos from url, title and description', () => {
    const { mentions } = extractRepoMentions([
      feed('hackernews', { url: 'https://github.com/leonickson1/Swiftlet' }),
      feed('lobsters', { title: 'see github.com/o/two for the kernel' }),
      feed('simon-willison', { description: 'https://github.com/o/three is worth a read' }),
    ]);
    expect(mentions.map((m) => m.full_name).sort()).toEqual([
      'leonickson1/Swiftlet',
      'o/three',
      'o/two',
    ]);
  });

  it('dedupes one repo across sources and keeps who mentioned it', () => {
    const { mentions } = extractRepoMentions([
      feed('hackernews', { url: 'https://github.com/o/hot' }),
      feed('lobsters', { url: 'https://github.com/o/hot' }),
      feed('hackernews', { title: 'more on github.com/o/hot' }),
    ]);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].mentioned_by).toEqual(['hackernews', 'lobsters']);
  });

  it('normalizes deep links to the repo root', () => {
    const { mentions } = extractRepoMentions([
      feed('lmcache-releases', { url: 'https://github.com/LMCache/LMCache/releases/tag/v0.5.3' }),
      feed('hackernews', { url: 'https://github.com/o/r/blob/main/src/a.ts#L10' }),
    ]);
    expect(mentions.map((m) => m.full_name).sort()).toEqual(['LMCache/LMCache', 'o/r']);
  });

  it('strips .git suffixes and trailing prose punctuation', () => {
    const { mentions } = extractRepoMentions([
      feed('blog', {
        description: 'clone https://github.com/o/one.git then read github.com/o/two.',
      }),
    ]);
    expect(mentions.map((m) => m.full_name).sort()).toEqual(['o/one', 'o/two']);
  });

  it('ignores github.com paths that are not user repos', () => {
    const { mentions } = extractRepoMentions([
      feed('blog', { url: 'https://github.com/features/copilot' }),
      feed('blog', { title: 'github.com/orgs/acme/projects/3' }),
      feed('blog', { description: 'https://github.com/sponsors/someone' }),
      feed('blog', { description: 'https://github.com/settings/tokens' }),
    ]);
    expect(mentions).toEqual([]);
  });

  it('ranks by distinct mentioning sources and reports what the cap dropped', () => {
    const items = [
      feed('hackernews', { url: 'https://github.com/o/a' }),
      feed('lobsters', { url: 'https://github.com/o/a' }),
      feed('hackernews', { url: 'https://github.com/o/b' }),
      feed('hackernews', { url: 'https://github.com/o/c' }),
    ];
    const { mentions, dropped } = extractRepoMentions(items, { limit: 2 });
    expect(mentions[0].full_name).toBe('o/a');
    expect(mentions).toHaveLength(2);
    expect(dropped).toBe(1);
  });

  it('tolerates a missing or empty feed list', () => {
    expect(extractRepoMentions(undefined)).toEqual({ mentions: [], dropped: 0 });
    expect(extractRepoMentions([])).toEqual({ mentions: [], dropped: 0 });
  });
});

describe('buildFeedRepoItems', () => {
  const repo = {
    full_name: 'o/hot',
    html_url: 'https://github.com/o/hot',
    description: 'a thing',
    language: 'TypeScript',
    stargazers_count: 120,
    forks_count: 4,
    open_issues_count: 2,
    created_at: '2026-08-01',
    pushed_at: '2026-08-06',
    default_branch: 'main',
    license: { spdx_id: 'MIT' },
    fork: false,
  };

  it('maps a repo into the funnel candidate shape', async () => {
    const items = await buildFeedRepoItems({
      mentions: [{ full_name: 'o/hot', mentioned_by: ['hackernews'] }],
      fetchRepo: async () => repo,
      fetchReadme: async () => 'readme text',
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'github-feed',
      full_name: 'o/hot',
      url: 'https://github.com/o/hot',
      stars: 120,
      forks: 4,
      created_at: '2026-08-01',
      pushed_at: '2026-08-06',
      license: 'MIT',
      fork: false,
      default_branch: 'main',
      readme_excerpt: 'readme text',
      mentioned_by: ['hackernews'],
    });
  });

  it('skips repos the API could not resolve instead of failing the batch', async () => {
    const items = await buildFeedRepoItems({
      mentions: [
        { full_name: 'o/gone', mentioned_by: ['hackernews'] },
        { full_name: 'o/hot', mentioned_by: ['lobsters'] },
      ],
      fetchRepo: async (fullName) => {
        if (fullName === 'o/gone') throw new Error('Not Found');
        return repo;
      },
      fetchReadme: async () => '',
    });
    expect(items.map((i) => i.full_name)).toEqual(['o/hot']);
  });

  it('survives a readme fetch failure', async () => {
    const items = await buildFeedRepoItems({
      mentions: [{ full_name: 'o/hot', mentioned_by: ['hackernews'] }],
      fetchRepo: async () => repo,
      fetchReadme: async () => {
        throw new Error('no readme');
      },
    });
    expect(items[0].readme_excerpt).toBe('');
  });
});
