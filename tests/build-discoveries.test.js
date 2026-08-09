import { expect, it } from 'vitest';
import { buildDiscoveries } from '../src/lib/build-discoveries.js';

const base = {
  url: '',
  stars: 0,
  forks: 0,
  created_at: '2026-06-10',
  pushed_at: '2026-06-15',
  fork: false,
  license: 'MIT',
  default_branch: 'main',
  readme_excerpt: 'x',
  source: 'github-search',
};
const goodTree = [
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/d.ts',
  'src/e.ts',
  'tests/a.test.ts',
  '.github/workflows/ci.yml',
  'tsconfig.json',
  'package-lock.json',
];

it('passes a fast-rising, well-engineered, unseen repo', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/fast', url: 'https://github.com/o/fast', stars: 200 }],
    history: {
      'o/fast': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 50 },
          { date: '2026-06-15', stars: 200 },
        ],
      },
    },
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });
  expect(out.candidates.map((c) => c.full_name)).toEqual(['o/fast']);
  expect(out.candidates[0].eng_score).toBeGreaterThanOrEqual(3);
  expect(out.candidates[0].velocity_per_day).toBeGreaterThan(5);
});

it('drops a seen repo, a flat repo, and a fork; watchlists a brand-new one', async () => {
  const out = await buildDiscoveries({
    items: [
      { ...base, full_name: 'o/seen', url: 'https://github.com/o/seen', stars: 300 },
      { ...base, full_name: 'o/flat', url: 'https://github.com/o/flat', stars: 50 },
      { ...base, full_name: 'o/fork', fork: true, url: 'https://github.com/o/fork', stars: 300 },
      { ...base, full_name: 'o/new', url: 'https://github.com/o/new', stars: 40 },
    ],
    history: {
      'o/flat': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 30 },
          { date: '2026-06-15', stars: 50 },
        ],
      },
      'o/new': {
        first_seen: '2026-06-14',
        snapshots: [
          { date: '2026-06-14', stars: 30 },
          { date: '2026-06-15', stars: 40 },
        ],
      },
    },
    seen: new Set(['o/seen']),
    feedItems: [],
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });
  expect(out.candidates.map((c) => c.full_name)).toEqual([]);
  expect(out.watchlist.map((c) => c.full_name)).toEqual(['o/new']);
  expect(out.stats).toMatchObject({ survivors: 0, watchlisted: 1 });
});

// Review finding merge-4: the ledger stores canonicalRepoKey() forms, so the
// exclusion must key the same way — a raw full_name with e.g. a trailing
// ".git" would dodge the dedup and re-show a seen repo.
it('excludes a seen repo via the canonical key, not the raw full_name', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/seen.git', url: 'https://github.com/o/seen', stars: 300 }],
    history: {
      'o/seen': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 50 },
          { date: '2026-06-15', stars: 300 },
        ],
      },
    },
    seen: new Set(['o/seen']),
    feedItems: [],
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });
  expect(out.candidates).toEqual([]);
  expect(out.watchlist).toEqual([]);
});

// #165's intent: the ledger clock starts at discovery, so a repo new to the pool
// has no history to judge on and would be watchlisted (skipping the tree fetch,
// so it never earns a real eng_score) however strong the outside signal is.
it('external validation rescues a cold-start repo past the velocity gate', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/niche', url: 'https://github.com/o/niche', stars: 50 }],
    history: {
      'o/niche': {
        first_seen: '2026-06-15',
        snapshots: [{ date: '2026-06-15', stars: 50 }],
      },
    },
    feedItems: [
      { source: 'simonwillison', url: 'https://github.com/o/niche', title: '', description: '' },
    ],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });
  expect(out.candidates.map((c) => c.full_name)).toEqual(['o/niche']);
  expect(out.candidates[0].validation_refs).toContain('simonwillison');
});

// disc-2 (2026-08-07 review): the waiver stops where the ledger starts having
// something to say. Every github-feed candidate is validated by construction —
// it entered the pool because a feed mentioned it, and externalValidation scans
// those same items — so a broader waiver would have exempted that whole intake
// from the velocity gate permanently.
it('does not rescue a flat repo once the ledger has history on it', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/niche', url: 'https://github.com/o/niche', stars: 50 }],
    history: {
      'o/niche': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 30 },
          { date: '2026-06-15', stars: 50 },
        ],
      },
    },
    feedItems: [
      { source: 'simonwillison', url: 'https://github.com/o/niche', title: '', description: '' },
    ],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });
  expect(out.candidates).toEqual([]);
  expect(out.watchlist).toEqual([]);
});

it('drops a pass-velocity repo that fails the engineering gate', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/thin', url: 'https://github.com/o/thin', stars: 200 }],
    history: {
      'o/thin': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 50 },
          { date: '2026-06-15', stars: 200 },
        ],
      },
    },
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => ['README.md'],
  });
  expect(out.candidates).toEqual([]);
});

const fastItem = { ...base, full_name: 'o/fast', url: 'https://github.com/o/fast', stars: 200 };
const fastHistory = {
  'o/fast': {
    first_seen: '2026-06-08',
    snapshots: [
      { date: '2026-06-08', stars: 50 },
      { date: '2026-06-15', stars: 200 },
    ],
  },
};
const baseDiscoveriesArgs = {
  items: [fastItem],
  history: fastHistory,
  feedItems: [],
  seen: new Set(),
  todayISO: '2026-06-15',
  fetchTree: async () => goodTree,
};

it('omitting the behavioral fetchers reproduces the P2 behavior exactly', async () => {
  const out = await buildDiscoveries({ ...baseDiscoveriesArgs });
  const c = out.candidates[0];
  expect(c.full_name).toBe('o/fast');
  expect(c.commit_continuity).toBeUndefined();
  expect(c.contributor_diversity).toBeUndefined();
  expect(c.downloads).toBeUndefined();
});

it('enriches the top survivors with behavioral signals and recomputes the score', async () => {
  const p2 = await buildDiscoveries({ ...baseDiscoveriesArgs });
  const p2Score = p2.candidates[0].excellence_score;

  const out = await buildDiscoveries({
    ...baseDiscoveriesArgs,
    fetchCommits: async () => [{ login: 'a', date: '2026-06-14T00:00:00Z', message: 'feat: x' }],
    fetchContributors: async () => [
      { login: 'a', contributions: 5 },
      { login: 'b', contributions: 4 },
    ],
    fetchDownloads: async () => 8000,
  });
  const c = out.candidates[0];
  expect(c.full_name).toBe('o/fast');
  expect(c.commit_continuity).toMatchObject({ daysWithCommits: 1, nonBotCommits: 1 });
  expect(typeof c.contributor_diversity).toBe('number');
  expect(c.contributor_diversity).toBeGreaterThan(0);
  expect(c.downloads).toBe(8000);
  expect(c.excellence_score).not.toBe(p2Score);
});

it('carries description and readme_excerpt onto candidates and watchlist for the novelty judge', async () => {
  const out = await buildDiscoveries({
    items: [
      {
        ...base,
        full_name: 'o/fast',
        url: 'https://github.com/o/fast',
        stars: 200,
        description: 'signs every MCP tool call against a capability manifest',
        readme_excerpt: 'detailed mechanism writeup',
      },
      {
        ...base,
        full_name: 'o/new',
        url: 'https://github.com/o/new',
        stars: 40,
        description: 'brand-new constrained-decoding KG extractor',
        readme_excerpt: 'early readme',
      },
    ],
    history: {
      'o/fast': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 50 },
          { date: '2026-06-15', stars: 200 },
        ],
      },
      'o/new': {
        first_seen: '2026-06-14',
        snapshots: [
          { date: '2026-06-14', stars: 30 },
          { date: '2026-06-15', stars: 40 },
        ],
      },
    },
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  const fast = out.candidates.find((c) => c.full_name === 'o/fast');
  expect(fast.description).toBe('signs every MCP tool call against a capability manifest');
  expect(fast.readme_excerpt).toBe('detailed mechanism writeup');

  const fresh = out.watchlist.find((w) => w.full_name === 'o/new');
  expect(fresh.description).toBe('brand-new constrained-decoding KG extractor');
});

it('scores a cold-start repo that external feeds already validated', async () => {
  const out = await buildDiscoveries({
    items: [
      { ...base, full_name: 'o/hot', url: 'https://github.com/o/hot', stars: 40 },
      { ...base, full_name: 'o/quiet', url: 'https://github.com/o/quiet', stars: 40 },
    ],
    // Both first seen today — neither can have a velocity verdict.
    history: {
      'o/hot': { first_seen: '2026-06-15', snapshots: [{ date: '2026-06-15', stars: 40 }] },
      'o/quiet': { first_seen: '2026-06-15', snapshots: [{ date: '2026-06-15', stars: 40 }] },
    },
    feedItems: [
      {
        source: 'hackernews',
        url: 'https://github.com/o/hot',
        title: 'Show HN: o/hot',
        description: '',
      },
    ],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  const hot = out.candidates.find((c) => c.full_name === 'o/hot');
  expect(hot).toBeDefined();
  expect(hot.excellence_score).toBeGreaterThan(0);
  expect(hot.eng_score).toBeGreaterThanOrEqual(3);
  expect(hot.validation_refs).toEqual(['hackernews']);

  // Unvalidated cold-start still watchlists — the override is validation-only.
  expect(out.watchlist.map((w) => w.full_name)).toEqual(['o/quiet']);
});

// --- rejection ledger -------------------------------------------------------
// All three gates drop a repo with a bare `continue`, so staging recorded only
// survivors and the watchlist. When #178 tightened velocityGatePass, "which
// repos did that actually drop today?" turned out to be unanswerable from the
// run's own artifacts — the candidate pool lives only in collect's memory, and
// re-running collect samples different topics. Each rejection now records the
// gate, its reason, and the numbers the verdict was computed from.

it('records which gate dropped each repo, and why', async () => {
  const out = await buildDiscoveries({
    items: [
      { ...base, full_name: 'o/fork', url: 'https://github.com/o/fork', fork: true, stars: 300 },
      { ...base, full_name: 'o/bare', url: 'https://github.com/o/bare', license: null, stars: 300 },
      { ...base, full_name: 'o/flat', url: 'https://github.com/o/flat', stars: 50 },
      { ...base, full_name: 'o/sloppy', url: 'https://github.com/o/sloppy', stars: 200 },
    ],
    history: {
      'o/flat': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 30 },
          { date: '2026-06-15', stars: 50 },
        ],
      },
      'o/sloppy': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 50 },
          { date: '2026-06-15', stars: 200 },
        ],
      },
    },
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    // o/sloppy clears velocity, then fails the engineering gate on its tree.
    fetchTree: async (item) => (item.full_name === 'o/sloppy' ? ['README.md'] : goodTree),
  });

  const byName = Object.fromEntries(out.rejected.map((r) => [r.full_name, r]));
  expect(byName['o/fork']).toMatchObject({ gate: 'free', reason: 'fork' });
  expect(byName['o/bare']).toMatchObject({ gate: 'free', reason: 'no-license' });
  expect(byName['o/flat']).toMatchObject({ gate: 'velocity' });
  expect(byName['o/sloppy']).toMatchObject({ gate: 'engineering' });
});

// The velocity verdict is the one worth reconstructing after the fact: the
// cold-start waiver turns on has_validation and history_days, so a rejection
// that carries both can be re-judged against a changed gate without the pool.
it('carries the inputs a velocity verdict was computed from', async () => {
  const out = await buildDiscoveries({
    items: [{ ...base, full_name: 'o/flat', url: 'https://github.com/o/flat', stars: 50 }],
    history: {
      'o/flat': {
        first_seen: '2026-06-08',
        snapshots: [
          { date: '2026-06-08', stars: 30 },
          { date: '2026-06-15', stars: 50 },
        ],
      },
    },
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  const flat = out.rejected.find((r) => r.full_name === 'o/flat');
  expect(flat.detail).toMatchObject({
    history_days: 7,
    total_stars: 50, // velocityStats.totalStars is the latest count, not the delta
    spike: false,
    has_validation: false,
  });
  expect(flat.detail.velocity_per_day).toBeCloseTo(20 / 7, 5);
});

// Which intake a rejection came from is what judging an intake's yield needs:
// the pool that would let you reconstruct it lives only in collect's memory,
// so a rejection that does not name its source leaves the question unanswerable
// even with the whole file in hand.
it('records which intake each rejected repo came from', async () => {
  const out = await buildDiscoveries({
    items: [
      {
        ...base,
        full_name: 'o/fork',
        url: 'https://github.com/o/fork',
        fork: true,
        stars: 300,
        source: 'github-feed',
      },
      {
        ...base,
        full_name: 'o/bare',
        url: 'https://github.com/o/bare',
        license: null,
        stars: 300,
        source: 'github-search',
      },
    ],
    history: {},
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  const byName = Object.fromEntries(out.rejected.map((r) => [r.full_name, r]));
  expect(byName['o/fork'].source).toBe('github-feed');
  expect(byName['o/bare'].source).toBe('github-search');
});

it('records a null source for a repo that arrived without one', async () => {
  const { source: _drop, ...sourceless } = base;
  const out = await buildDiscoveries({
    items: [
      {
        ...sourceless,
        full_name: 'o/fork',
        url: 'https://github.com/o/fork',
        fork: true,
        stars: 9,
      },
    ],
    history: {},
    feedItems: [],
    seen: new Set(),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  expect(out.rejected[0].source).toBeNull();
});

it('counts rejections in stats and does not count deduped repos as rejected', async () => {
  const out = await buildDiscoveries({
    items: [
      { ...base, full_name: 'o/seen', url: 'https://github.com/o/seen', stars: 300 },
      { ...base, full_name: 'o/fork', url: 'https://github.com/o/fork', fork: true, stars: 300 },
    ],
    history: {},
    feedItems: [],
    seen: new Set(['o/seen']),
    todayISO: '2026-06-15',
    fetchTree: async () => goodTree,
  });

  // o/seen never enters the pool — it was published before, not judged today.
  expect(out.rejected.map((r) => r.full_name)).toEqual(['o/fork']);
  expect(out.stats.rejected).toBe(1);
  expect(out.stats.pool).toBe(1);
});
