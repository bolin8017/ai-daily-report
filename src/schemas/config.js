// Schema for config.json. Validated once at import time by src/lib/config.js
// (ConfigSchema.parse) — fetchers import that singleton and receive an
// already-validated, frozen object, so no fetcher re-parses or re-validates.
// Also available standalone via `npm run validate:config`.

import { z } from 'zod';
import { LensConfigSchema } from './lens.js';

export const ConfigSchema = z.object({
  sources: z.object({
    // Ordered list — rsshub provider tries URLs in order, falling through to
    // the next on any error (timeout, 5xx, network). At least one entry
    // required; extra entries are used only when earlier ones fail per request.
    rsshub_urls: z.array(z.url()).min(1),
    // Two accepted shapes (backward compatible):
    //   1. Legacy flat: { enabled, topics: [], limit_per_topic }
    //   2. Tier:        { enabled, tier: { core, rotating }, rotation: { rotating_per_day, rotation_seed_field }, limit_per_topic }
    // Stage 1 fetcher resolves to a per-day topic set via selectTopicsForDate().
    github_topics: z.union([
      z.object({
        enabled: z.boolean(),
        topics: z.array(z.string()),
        limit_per_topic: z.number().int().positive(),
      }),
      z.object({
        enabled: z.boolean(),
        tier: z.object({
          core: z.array(z.string()),
          rotating: z.array(z.string()),
        }),
        rotation: z.object({
          rotating_per_day: z.number().int().positive(),
          rotation_seed_field: z.literal('date'),
        }),
        limit_per_topic: z.number().int().positive(),
      }),
    ]),
    github_developers: z.object({
      enabled: z.boolean(),
      global_limit: z.number().int().positive(),
      global_min_followers: z.number().int().positive(),
      regions: z.array(
        z.object({
          name: z.string(),
          locations: z.array(z.string()),
          limit: z.number().int().positive(),
          min_followers: z.number().int().positive(),
        }),
      ),
      new_repo_window_hours: z.number().int().positive(),
    }),
  }),
  // Lens definitions for multi-lens fan-out. At least one lens required
  // (the default lens, ai-builder, drives the existing daily report).
  lenses: z.array(LensConfigSchema).min(1),
  // Cloud-fallback provider tuning. Optional with sensible defaults.
  providers: z
    .object({
      firecrawl: z
        .object({
          monthly_cap: z.number().int().positive().default(500),
          enabled_in_local_dev: z.boolean().default(false),
        })
        .optional(),
      jina_reader: z
        .object({
          base_url: z.string().url().default('https://r.jina.ai'),
        })
        .optional(),
    })
    .optional(),
  report: z.object({
    language: z.string(),
    max_featured_items: z.number().int().positive(),
    style: z.string(),
  }),
});
