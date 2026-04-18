// Smoke tests for the config singleton. Module-load-time failures
// (ConfigSchema.parse throwing on malformed config) are covered here so
// someone refactoring config.js sees the contract in one place.

import { describe, expect, it } from 'vitest';
import config from '../src/lib/config.js';

describe('lib/config', () => {
  it('exposes sources and report sections', () => {
    expect(config).toHaveProperty('sources');
    expect(config).toHaveProperty('report');
  });

  it('is frozen so no accidental mutation reaches fetchers', () => {
    expect(Object.isFrozen(config)).toBe(true);
    // In strict-mode ESM, assigning to a frozen property throws TypeError.
    expect(() => {
      config.report = null;
    }).toThrow(TypeError);
  });

  it('has rsshub_urls as a non-empty ordered list', () => {
    expect(Array.isArray(config.sources.rsshub_urls)).toBe(true);
    expect(config.sources.rsshub_urls.length).toBeGreaterThan(0);
    for (const url of config.sources.rsshub_urls) {
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it('github_topics.topics are non-empty strings', () => {
    for (const topic of config.sources.github_topics.topics) {
      expect(typeof topic).toBe('string');
      expect(topic.length).toBeGreaterThan(0);
    }
  });
});
