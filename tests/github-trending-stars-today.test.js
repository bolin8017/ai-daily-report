import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractRows, parseStarsToday } from '../src/fetchers/providers/github-trending-html.js';

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
