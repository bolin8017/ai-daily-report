// Contract tests for src/lib/github.js — the factory + README helper
// shared by three fetchers. Network is never actually called; we just
// verify the factory's auth-gating behavior.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeOctokit } from '../src/lib/github.js';

describe('makeOctokit', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('returns an Octokit instance without a token (anonymous mode)', () => {
    const octokit = makeOctokit();
    expect(octokit).toBeDefined();
    expect(octokit.request).toBeTypeOf('function');
  });

  it('returns an Octokit instance when GITHUB_TOKEN is set', () => {
    process.env.GITHUB_TOKEN = 'ghp_fake_value_for_tests_only';
    const octokit = makeOctokit();
    expect(octokit).toBeDefined();
    expect(octokit.request).toBeTypeOf('function');
  });

  it('throws when requireAuth is true and no token is present', () => {
    expect(() => makeOctokit({ requireAuth: true })).toThrow(/GITHUB_TOKEN is required/);
  });

  it('does not throw when requireAuth is true and a token is present', () => {
    process.env.GITHUB_TOKEN = 'ghp_fake_value_for_tests_only';
    expect(() => makeOctokit({ requireAuth: true })).not.toThrow();
  });
});
