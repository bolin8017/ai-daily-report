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

it('external validation rescues a flat repo past the velocity gate', async () => {
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
  expect(out.candidates.map((c) => c.full_name)).toEqual(['o/niche']);
  expect(out.candidates[0].validation_refs).toContain('simonwillison');
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
