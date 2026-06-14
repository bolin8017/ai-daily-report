import { describe, expect, it } from 'vitest';
import { getContributors, getRecentCommits } from '../src/lib/github.js';

const octo = (commits, contributors) => ({
  rest: {
    repos: {
      listCommits: async () => ({ data: commits }),
      listContributors: async () => ({ data: contributors }),
    },
  },
});

describe('getRecentCommits', () => {
  it('maps to {login,date,message}', async () => {
    const o = octo(
      [
        {
          author: { login: 'a' },
          commit: { author: { date: '2026-06-14T00:00:00Z' }, message: 'feat: x' },
        },
      ],
      [],
    );
    expect(await getRecentCommits(o, 'o', 'r')).toEqual([
      { login: 'a', date: '2026-06-14T00:00:00Z', message: 'feat: x' },
    ]);
  });
  it('returns [] on error (fail-soft)', async () => {
    const o = {
      rest: {
        repos: {
          listCommits: async () => {
            throw new Error('x');
          },
        },
      },
    };
    expect(await getRecentCommits(o, 'o', 'r')).toEqual([]);
  });
});

describe('getContributors', () => {
  it('maps to {login,contributions}', async () => {
    const o = octo(
      [],
      [
        { login: 'a', contributions: 12 },
        { login: 'b', contributions: 3 },
      ],
    );
    expect(await getContributors(o, 'o', 'r')).toEqual([
      { login: 'a', contributions: 12 },
      { login: 'b', contributions: 3 },
    ]);
  });
  it('returns [] on error', async () => {
    const o = {
      rest: {
        repos: {
          listContributors: async () => {
            throw new Error('x');
          },
        },
      },
    };
    expect(await getContributors(o, 'o', 'r')).toEqual([]);
  });
});
