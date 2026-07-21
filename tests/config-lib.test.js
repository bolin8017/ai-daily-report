// Smoke tests for the config singleton + theme-sourced fetcher inputs.
// config.json is an empty placeholder since 2026-07-21 (the dead providers /
// report fields were removed — review finding merge-3). The persona / voice /
// source list lives in themes/<active>/sources.yaml, validated separately.

import { describe, expect, it } from 'vitest';
import config from '../src/lib/config.js';
import { getThemeSources } from '../src/lib/theme.js';

describe('lib/config', () => {
  it('is frozen so no accidental mutation reaches fetchers', () => {
    expect(Object.isFrozen(config)).toBe(true);
    // In strict-mode ESM, assigning to a frozen property throws TypeError.
    expect(() => {
      config.report = null;
    }).toThrow(TypeError);
  });

  it('no longer carries the removed dead fields (or the pre-cutover blocks)', () => {
    expect(config).not.toHaveProperty('report');
    expect(config).not.toHaveProperty('providers');
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
      // Post-cutover this is the self-hosted RSSHub (http://localhost:1200); the
      // public https instances were retired, so accept http(s).
      expect(url).toMatch(/^https?:\/\//);
    }
  });
});
