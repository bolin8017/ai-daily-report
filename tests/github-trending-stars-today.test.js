import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  enrichRepo,
  extractRows,
  parseStarsToday,
} from '../src/fetchers/providers/github-trending-html.js';
import { freeGates } from '../src/lib/excellence.js';

describe('parseStarsToday', () => {
  it('parses a comma-formatted count', () => {
    expect(parseStarsToday('1,531 stars today')).toBe(1531);
  });
  it('parses a singular star', () => {
    expect(parseStarsToday('1 star today')).toBe(1);
  });
  it('returns null when there is no "stars today" text', () => {
    expect(parseStarsToday('42 stars')).toBeNull();
    expect(parseStarsToday('')).toBeNull();
    expect(parseStarsToday(null)).toBeNull();
  });
});

describe('extractRows', () => {
  it('pulls owner/repo and stars_today per row, deduping by full_name', () => {
    const html = `
      <article class="Box-row">
        <h2 class="h3"><a href="/owner-a/repo-a">owner-a / repo-a</a></h2>
        <div class="f6"><span class="d-inline-block float-sm-right">652 stars today</span></div>
      </article>
      <article class="Box-row">
        <h2 class="h3"><a href="/owner-b/repo-b">owner-b / repo-b</a></h2>
        <div class="f6"><span class="d-inline-block float-sm-right">12 stars today</span></div>
      </article>`;
    const $ = cheerio.load(html);
    expect(extractRows($)).toEqual([
      { fullName: 'owner-a/repo-a', starsToday: 652 },
      { fullName: 'owner-b/repo-b', starsToday: 12 },
    ]);
  });

  it('leaves starsToday null when the row has no "stars today" span', () => {
    const $ = cheerio.load(
      '<article class="Box-row"><h2 class="h3"><a href="/o/r">o / r</a></h2></article>',
    );
    expect(extractRows($)).toEqual([{ fullName: 'o/r', starsToday: null }]);
  });
});

describe('enrichRepo', () => {
  const freshRepo = {
    html_url: 'https://github.com/o/hot',
    description: 'd',
    language: 'TypeScript',
    stargazers_count: 500,
    forks_count: 10,
    topics: [],
    default_branch: 'main',
    license: { spdx_id: 'MIT' },
    fork: false,
    created_at: '2026-08-01T00:00:00Z',
    pushed_at: '2026-08-09T00:00:00Z',
  };
  const fakeOctokit = (repo) => ({
    rest: {
      repos: {
        get: async () => ({ data: repo }),
        getReadme: async () => ({ data: 'readme text' }),
      },
    },
  });

  it('carries the repo dates and its intake name onto the item', async () => {
    const item = await enrichRepo(fakeOctokit(freshRepo), 'o/hot', 1, 652);
    expect(item).toMatchObject({
      full_name: 'o/hot',
      created_at: '2026-08-01T00:00:00Z',
      pushed_at: '2026-08-09T00:00:00Z',
      source: 'github-trending',
    });
  });

  // The discoveries funnel's first gate judges on created_at/pushed_at. An item
  // that omits them is not old — it is unjudgeable, and freeGates cannot tell
  // the two apart, so it read every trending repo as "too-old" and the intake
  // contributed nothing from the day the funnel shipped.
  it('produces an item the funnel free gate can judge on its merits', async () => {
    const item = await enrichRepo(fakeOctokit(freshRepo), 'o/hot', 1, 652);
    expect(freeGates(item, { todayISO: '2026-08-09' })).toEqual({ pass: true, reason: null });
  });
});
