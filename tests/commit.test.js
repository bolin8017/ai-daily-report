import { afterEach, describe, expect, it } from 'vitest';
import { _internals } from '../src/lib/commit.js';

const { gitAuthEnv } = _internals;

describe('gitAuthEnv', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('returns empty object when no token is set', () => {
    delete process.env.GITHUB_TOKEN;
    expect(gitAuthEnv()).toEqual({});
  });

  it('builds a GIT_CONFIG_COUNT http.extraheader from the token', () => {
    process.env.GITHUB_TOKEN = 'ghp_test123';
    const env = gitAuthEnv();

    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');

    // Header format: Authorization: Basic <base64("x-access-token:<token>")>
    const expected = Buffer.from('x-access-token:ghp_test123').toString('base64');
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
  });

  it('never exposes the raw token in any env value', () => {
    process.env.GITHUB_TOKEN = 'ghp_should_not_appear_raw';
    const env = gitAuthEnv();
    for (const value of Object.values(env)) {
      expect(value).not.toContain('ghp_should_not_appear_raw');
    }
  });
});
