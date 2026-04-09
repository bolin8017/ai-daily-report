// Smoke tests for Zod schemas — ensures real fixture data validates cleanly.
// Run with: npx vitest

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/schemas/config.js';
import { FeedItemSchema } from '../src/schemas/feed-item.js';
import { MemorySchema } from '../src/schemas/memory.js';
import { ReportSchema } from '../src/schemas/report.js';

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

function latestReport() {
  const dir = 'data/reports';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  return files.length > 0 ? `${dir}/${files[0]}` : null;
}

describe('schemas', () => {
  it('config.json passes ConfigSchema', () => {
    const result = ConfigSchema.safeParse(json('config.json'));
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it.skipIf(!latestReport())('latest report passes ReportSchema', () => {
    const result = ReportSchema.safeParse(json(latestReport()));
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it.skipIf(!existsSync('data/memory.json'))('data/memory.json passes MemorySchema', () => {
    const result = MemorySchema.safeParse(json('data/memory.json'));
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });
});

describe('feed item shape', () => {
  it('accepts a minimal HN item', () => {
    const result = FeedItemSchema.safeParse({
      source: 'hackernews',
      title: 'Test',
      url: 'https://example.com',
      hn_url: 'https://news.ycombinator.com/item?id=1',
      hn_id: '1',
      rank: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Lobsters item with score and num_comments', () => {
    const result = FeedItemSchema.safeParse({
      source: 'Lobsters',
      title: 'Test',
      url: 'https://example.com',
      score: 50,
      num_comments: 10,
      tags: ['programming'],
      rank: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects items missing url', () => {
    const result = FeedItemSchema.safeParse({
      source: 'hackernews',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });
});
