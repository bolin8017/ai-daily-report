import { describe, expect, it } from 'vitest';
import { getRepoTree } from '../src/lib/github.js';

const fakeOctokit = (impl) => ({ rest: { git: { getTree: impl } } });

describe('getRepoTree', () => {
  it('returns the list of paths from the recursive tree', async () => {
    const octo = fakeOctokit(async () => ({
      data: {
        tree: [{ path: 'src/index.ts' }, { path: 'tests/a.test.ts' }, { path: 'README.md' }],
      },
    }));
    expect(await getRepoTree(octo, 'o', 'r', 'main')).toEqual([
      'src/index.ts',
      'tests/a.test.ts',
      'README.md',
    ]);
  });
  it('returns [] on API error (fail-soft, never throws)', async () => {
    const octo = fakeOctokit(async () => {
      throw new Error('rate limited');
    });
    expect(await getRepoTree(octo, 'o', 'r', 'main')).toEqual([]);
  });
  it('falls back to HEAD when no default branch is given', async () => {
    const calls = [];
    const octo = fakeOctokit(async (args) => {
      calls.push(args.tree_sha);
      return { data: { tree: [] } };
    });
    await getRepoTree(octo, 'o', 'r', null);
    expect(calls[0]).toBe('HEAD');
  });
});
