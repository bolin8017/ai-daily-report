// Schema for config.json. Validated once at import time by src/lib/config.js
// (ConfigSchema.parse) — fetchers import that singleton and receive an
// already-validated, frozen object, so no fetcher re-parses or re-validates.
// Also available standalone via `npm run validate:config`.

import { z } from 'zod';
import { FeedSourceSchema } from './feed-source.js';
import { LensConfigSchema } from './lens.js';

// Re-export for backwards compatibility with any consumer that did
// `import { FeedSourceSchema } from '../schemas/config.js'`.
export { FeedSourceSchema };

export const ConfigSchema = z.object({
  sources: z.object({
    // Ordered list — feeds.js tries URLs in order, falling through to the
    // next on any error (timeout, 5xx, network). At least one entry required;
    // extra entries are used only when earlier ones fail per request.
    rsshub_urls: z.array(z.url()).min(1),
    feeds: z.array(FeedSourceSchema),
    github_topics: z.object({
      enabled: z.boolean(),
      topics: z.array(z.string()),
      limit_per_topic: z.number().int().positive(),
    }),
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
  report: z.object({
    language: z.string(),
    max_featured_items: z.number().int().positive(),
    style: z.string(),
  }),
});
