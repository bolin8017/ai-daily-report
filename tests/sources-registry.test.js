import { describe, expect, it } from 'vitest';
import { listProviders } from '../src/fetchers/providers/_registry.js';
import { ItemSchemas } from '../src/schemas/items/index.js';
import { RegistrySchema } from '../src/schemas/source.js';
import sources from '../src/sources/registry.js';

// Side-effect imports so provider registry is populated
import '../src/fetchers/providers/arxiv-rss.js';
import '../src/fetchers/providers/firecrawl.js';
import '../src/fetchers/providers/github-catalog.js';
import '../src/fetchers/providers/github-developers-api.js';
import '../src/fetchers/providers/github-developers-html.js';
import '../src/fetchers/providers/github-search-api.js';
import '../src/fetchers/providers/github-trending-html.js';
import '../src/fetchers/providers/hf-trending-json.js';
import '../src/fetchers/providers/hn-firebase.js';
import '../src/fetchers/providers/jina-reader.js';
import '../src/fetchers/providers/leaderboard-html.js';
import '../src/fetchers/providers/lobsters-json.js';
import '../src/fetchers/providers/mops-twse-openapi.js';
import '../src/fetchers/providers/native-json.js';
import '../src/fetchers/providers/native-rss.js';
import '../src/fetchers/providers/rsshub.js';

describe('source registry', () => {
  it('all 53 sources validate against RegistrySchema', () => {
    const result = RegistrySchema.safeParse(sources);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect(sources).toHaveLength(53);
  });

  it('every itemType referenced exists in ItemSchemas', () => {
    for (const s of sources) {
      expect(ItemSchemas[s.itemType], `unknown itemType ${s.itemType} in ${s.id}`).toBeDefined();
    }
  });

  it('every provider referenced exists in provider registry', () => {
    const known = new Set(listProviders());
    for (const s of sources) {
      for (const entry of s.chain) {
        expect(known.has(entry.provider), `unknown provider ${entry.provider} in ${s.id}`).toBe(
          true,
        );
      }
    }
  });

  it('source ids are unique', () => {
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
