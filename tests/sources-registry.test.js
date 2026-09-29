import { describe, expect, it } from 'vitest';
import { listProviders } from '../src/fetchers/providers/_registry.js';
import { ItemSchemas } from '../src/schemas/items/index.js';
import { RegistrySchema } from '../src/schemas/source.js';
import sources from '../src/sources/registry.js';

// Side-effect imports so provider registry is populated
import '../src/fetchers/providers/arxiv-rss.js';
import '../src/fetchers/providers/firecrawl.js';
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
  it('all 69 sources validate against RegistrySchema', () => {
    const result = RegistrySchema.safeParse(sources);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect(sources).toHaveLength(69);
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

// The rule runs in Miniflux (Go RE2), not here; this pins its intent against
// real FastVideo titles sampled 2026-09-29. RE2's leading (?i) has no JS
// equivalent, so it is translated to the 'i' flag.
describe('fastvideo-commits block rule', () => {
  const src = sources.find((s) => s.id === 'fastvideo-commits');
  const rule = src.chain[0].config.blockFilterEntryRules;
  const [field, pattern] = rule.split(/=(.*)/s);
  const re = new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i');

  it('is a single EntryTitle rule', () => {
    expect(field).toBe('EntryTitle');
    expect(rule).not.toMatch(/\n/);
  });

  it.each([
    '[bugfix] Fix MLX prompt enhancement sampler compatibility (#1891)',
    '[bugfix]: workers killed by a signal now log the reason (#1725)',
    '[docs]: add cookbook link to README (#1810)',
    '[ci] make GPU validation change-aware (#1747)',
    '[chore]: release v0.2.1 (#1778)',
    '[refactor] Group Wan transformer and config (#1823)',
    "Merge remote-tracking branch 'origin/main' into aryan/pr-1863-fasth3-8step",
  ])('drops %s', (title) => expect(re.test(title)).toBe(true));

  it.each([
    '[feat] add MXFP8 support on H3 (#1796)',
    '[perf] Reuse cached VAE offload for H3 conditioning (#1882)',
    '[kernel] sm_100a CUDA backward for VSA block-sparse attention (blk64) (#1819)',
    '[misc] FastVideo Studio UI Additions (H3 Ref2V support) (#1783)',
    'Add H3 support into Dreamverse (#1800)',
    'feat(mlx): add FastH3-8-Step-V2 DMD schedule and thermal-safe MLX inference',
  ])('keeps %s', (title) => expect(re.test(title)).toBe(false));
});
