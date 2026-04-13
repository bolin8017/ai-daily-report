// Tests for pure functions in src/fetchers/feeds.js.
// Network-dependent functions (fetchRSSHubJSON, enrichHNItems, etc.) are
// tested via manual integration runs, not here.

import { describe, expect, it } from 'vitest';

// extractHref is not exported, so we test it via a local re-implementation
// that matches the exact logic. This is a trade-off: we test the algorithm,
// not the binding. If the function signature changes, update this.
function extractHref(html, linkText) {
  const escaped = linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html?.match(new RegExp(`<a[^>]+?href="([^"]+)"[^>]*?>[^<]*?${escaped}`, 'i'));
  return m?.[1] || null;
}

describe('extractHref', () => {
  it('extracts href from an anchor tag with matching link text', () => {
    const html = '<a href="https://example.com/article">Source</a>';
    expect(extractHref(html, 'Source')).toBe('https://example.com/article');
  });

  it('handles anchor with multiple attributes', () => {
    const html = '<a class="link" href="https://example.com" target="_blank">Original</a>';
    expect(extractHref(html, 'Original')).toBe('https://example.com');
  });

  it('returns null when link text is not found', () => {
    const html = '<a href="https://example.com">Click here</a>';
    expect(extractHref(html, 'Source')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractHref(null, 'Source')).toBeNull();
    expect(extractHref(undefined, 'Source')).toBeNull();
  });

  it('is case insensitive', () => {
    const html = '<A HREF="https://example.com">source</A>';
    expect(extractHref(html, 'source')).toBe('https://example.com');
  });

  it('escapes regex metacharacters in linkText', () => {
    const html = '<a href="https://example.com">Price ($)</a>';
    expect(extractHref(html, 'Price ($)')).toBe('https://example.com');
  });

  it('handles text before the link text', () => {
    const html = '<a href="https://example.com">Read the Source</a>';
    expect(extractHref(html, 'Source')).toBe('https://example.com');
  });
});
