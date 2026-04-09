// Schema for config.json — validated by scripts/run.sh (Phase 1) and
// `npm run validate:config`. Note: individual fetchers read config without
// re-validating — the pipeline entry point is the single validation gate.

import { z } from 'zod';

const FeedSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rsshub'),
    name: z.string(),
    route: z.string().startsWith('/'),
    normalize: z.enum(['hackernews']).optional(),
    category: z.string(),
    limit: z.number().int().positive(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('rss'),
    name: z.string(),
    url: z.url(),
    category: z.string(),
    limit: z.number().int().positive(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('json'),
    name: z.string(),
    url: z.url(),
    normalize: z.enum(['lobsters']).optional(),
    category: z.string(),
    limit: z.number().int().positive(),
    enabled: z.boolean().optional(),
  }),
]);

export const ConfigSchema = z.object({
  sources: z.object({
    rsshub_url: z.url(),
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
  report: z.object({
    language: z.string(),
    max_featured_items: z.number().int().positive(),
    style: z.string(),
  }),
});
