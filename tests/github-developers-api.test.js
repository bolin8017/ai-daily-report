import { expect, it, vi } from 'vitest';

// getReadmeExcerpt reaches the network via octokit; stub it so processUser stays
// a pure assembly unit driven entirely by the injected fake octokit.
vi.mock('../src/lib/github.js', async (orig) => ({
  ...(await orig()),
  getReadmeExcerpt: vi.fn(async () => 'readme excerpt'),
}));

import { processUser } from '../src/fetchers/providers/github-developers-api.js';

const repo = {
  full_name: 'dev/new-repo',
  html_url: 'https://github.com/dev/new-repo',
  description: 'a concrete mechanism',
  language: 'TypeScript',
  stargazers_count: 42,
  created_at: '2026-06-20T00:00:00Z',
  pushed_at: '2026-06-21T00:00:00Z',
  forks_count: 1,
  default_branch: 'main',
  license: { spdx_id: 'MIT' },
  fork: false,
};

const octokit = {
  rest: {
    repos: { listForUser: async () => ({ data: [repo] }) },
    users: { getByUsername: async () => ({ data: { followers: 1000 } }) },
  },
};

it('emits pushed_at so freeGates staleness can judge developer repos', async () => {
  const cutoffMs = Date.parse('2026-06-19T00:00:00Z');
  const item = await processUser(octokit, cutoffMs, 'dev', 'global');
  expect(item).not.toBeNull();
  expect(item.pushed_at).toBe('2026-06-21T00:00:00Z');
});

// Honest fake: it slices to the per_page the caller asked for, so a listing
// request that still asks for a single repo cannot see past a leading fork.
function fakeOctokit(repos) {
  const calls = { followerLookups: 0 };
  return {
    calls,
    rest: {
      repos: {
        listForUser: async ({ per_page }) => ({ data: repos.slice(0, per_page ?? 1) }),
      },
      users: {
        getByUsername: async () => {
          calls.followerLookups++;
          return { data: { followers: 1000 } };
        },
      },
    },
  };
}

const fork = { ...repo, full_name: 'dev/forked-upstream', fork: true };

it('skips a leading fork and takes the newest original repo', async () => {
  const cutoffMs = Date.parse('2026-06-19T00:00:00Z');
  const own = { ...repo, full_name: 'dev/own-work', created_at: '2026-06-19T12:00:00Z' };

  const item = await processUser(fakeOctokit([fork, own]), cutoffMs, 'dev', 'global');

  expect(item?.full_name).toBe('dev/own-work');
});

it('returns null without spending calls when every recent repo is a fork', async () => {
  const cutoffMs = Date.parse('2026-06-19T00:00:00Z');
  const octo = fakeOctokit([fork, { ...fork, full_name: 'dev/another-fork' }]);

  const item = await processUser(octo, cutoffMs, 'dev', 'global');

  expect(item).toBeNull();
  expect(octo.calls.followerLookups).toBe(0);
});
