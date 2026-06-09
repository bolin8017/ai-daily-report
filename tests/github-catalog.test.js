// Unit tests for the pure catalog pool-shaping logic. The provider's GitHub
// network calls are integration-tested manually; shapeCatalogPool is the
// dedup + ranking core and is unit-testable.

import { describe, expect, it } from 'vitest';
import { coreTopics, shapeCatalogPool } from '../src/fetchers/providers/github-catalog.js';

function repo(full_name, stars) {
  return { full_name, stargazers_count: stars };
}

describe('coreTopics', () => {
  it('returns deduped github terms from level:core interests only', () => {
    const reg = {
      interests: {
        a: { level: 'core', github: ['agent', 'ai-agent'] },
        b: { level: 'core', github: ['ai-agent', 'mcp'] },
        c: { level: 'rotating', github: ['kv-cache'] },
        d: { level: 'off', github: ['robotics'] },
      },
    };
    expect(coreTopics(reg).sort()).toEqual(['agent', 'ai-agent', 'mcp']);
  });
});

describe('shapeCatalogPool', () => {
  it('excludes seen repos, dedupes, ranks by stars desc, and caps each pool', () => {
    const ai = [repo('a/seen', 90000), repo('a/x', 50000), repo('a/y', 40000), repo('a/x', 50000)];
    const general = [repo('g/seen', 99000), repo('a/x', 50000), repo('g/z', 35000)];
    const seen = new Set(['a/seen', 'g/seen']);
    const out = shapeCatalogPool({ ai, general, seen, aiPoolSize: 2, generalPoolSize: 5 });

    // ai: seen dropped, deduped, top-2 by stars
    expect(out.ai.map((r) => r.full_name)).toEqual(['a/x', 'a/y']);
    expect(out.ai[0]).toMatchObject({ full_name: 'a/x', stars: 50000, category: 'ai' });
    // general: seen dropped AND anything already in the ai pool dropped (a/x)
    expect(out.general.map((r) => r.full_name)).toEqual(['g/z']);
    expect(out.general[0].category).toBe('general');
  });
});
