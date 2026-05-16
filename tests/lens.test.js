// Schema tests for LensConfigSchema — the config.json → lenses[] entry shape.

import { describe, expect, it } from 'vitest';
import { LensConfigSchema } from '../src/schemas/lens.js';

describe('LensConfigSchema', () => {
  it('accepts minimal valid lens config', () => {
    const result = LensConfigSchema.safeParse({
      id: 'ai-builder',
      name: '今日 AI',
      prompt_file: '.claude/lenses/ai-builder.md',
      output_paths: {
        report: 'data/reports/{date}.json',
        memory: 'data/memory.json',
      },
    });
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('rejects invalid id (uppercase)', () => {
    const result = LensConfigSchema.safeParse({
      id: 'AI-Builder',
      name: '今日 AI',
      prompt_file: '.claude/lenses/ai-builder.md',
    });
    expect(result.success).toBe(false);
  });

  it('accepts overlay with feeds reusing FeedSourceSchema', () => {
    const result = LensConfigSchema.safeParse({
      id: 'phison-aidaptiv',
      name: 'Phison aiDAPTIV+',
      critical: false,
      prompt_file: '.claude/lenses/phison-aidaptiv.md',
      sources_overlay: {
        feeds: [
          {
            type: 'rss',
            name: 'Phison Blog',
            url: 'https://phisonblog.com/feed/',
            category: 'phison',
            limit: 10,
          },
        ],
        github_topics: { topics: ['kv-cache', 'local-llm'] },
      },
      rotation: { starvation_threshold_days: 7 },
      output_paths: {
        report: 'data/reports/lenses/{id}/{date}.json',
        memory: 'data/memory/{id}.json',
      },
    });
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('rejects overlay feeds with invalid type', () => {
    const result = LensConfigSchema.safeParse({
      id: 'phison-aidaptiv',
      name: 'Phison',
      prompt_file: '.claude/lenses/phison-aidaptiv.md',
      sources_overlay: {
        feeds: [{ type: 'bogus', name: 'X', url: 'https://x.com', category: 'x', limit: 5 }],
      },
    });
    expect(result.success).toBe(false);
  });
});
