// Smoke tests for the config singleton + theme-sourced fetcher inputs.
// After the theme bundle cutover, config.json only holds environment-level
// tuning (cloud-fallback providers, report rendering). The persona / voice /
// source list lives in themes/<active>/sources.yaml, validated separately.

import { describe, expect, it } from 'vitest';
import config from '../src/lib/config.js';
import { getThemeSources } from '../src/lib/theme.js';

describe('lib/config', () => {
  it('exposes report section', () => {
    expect(config).toHaveProperty('report');
  });

  it('is frozen so no accidental mutation reaches fetchers', () => {
    expect(Object.isFrozen(config)).toBe(true);
    // In strict-mode ESM, assigning to a frozen property throws TypeError.
    expect(() => {
      config.report = null;
    }).toThrow(TypeError);
  });

  it('no longer carries `sources` or `lenses` (moved to theme bundle)', () => {
    expect(config).not.toHaveProperty('sources');
    expect(config).not.toHaveProperty('lenses');
  });
});

describe('theme sources (post-cutover authoritative source)', () => {
  it('has rsshub_urls as a non-empty ordered list', async () => {
    const sources = await getThemeSources('ai-builder');
    expect(Array.isArray(sources.rsshub_urls)).toBe(true);
    expect(sources.rsshub_urls.length).toBeGreaterThan(0);
    for (const url of sources.rsshub_urls) {
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it('github_topics resolves to non-empty strings (tier or legacy)', async () => {
    const sources = await getThemeSources('ai-builder');
    const gt = sources.github_topics;
    const allTopics = Array.isArray(gt.topics)
      ? gt.topics
      : [...(gt.tier?.core ?? []), ...(gt.tier?.rotating ?? [])];
    expect(allTopics.length).toBeGreaterThan(0);
    for (const topic of allTopics) {
      expect(typeof topic).toBe('string');
      expect(topic.length).toBeGreaterThan(0);
    }
  });
});
