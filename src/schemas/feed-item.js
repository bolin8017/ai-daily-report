// Schema for normalized feed items produced by src/fetchers/feeds.js
// and src/fetchers/github-trending.js. Validated by run.sh Phase 1
// against tmp/*.json after fetchers write their output.

import { z } from 'zod';

export const FeedItemSchema = z.object({
  source: z.string(), // 'hackernews' | 'Lobsters' | 'Dev.to Top' | etc.
  title: z.string().optional(), // missing for github-trending (uses full_name)
  full_name: z.string().optional(), // github-trending only
  url: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  author: z.string().optional(),
  published: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  rank: z.number().int().positive().optional(),
  // HN-specific
  hn_url: z.string().optional(),
  hn_id: z.string().optional(),
  score: z.number().int().nonnegative().optional(),
  num_comments: z.number().int().nonnegative().optional(),
  comments: z
    .array(
      z.object({
        text: z.string(),
        score: z.number().int().nonnegative(),
        by: z.string(),
      }),
    )
    .optional(),
  // GitHub trending
  language: z.string().nullable().optional(),
  stars: z.number().int().nonnegative().optional(),
  forks: z.number().int().nonnegative().optional(),
  // Lobsters
  discussion_url: z.string().optional(),
});

// Envelope returned by every fetcher on stdout. run.sh Phase 1 validates this
// shape before proceeding. Fields are optional because different fetchers
// populate different subsets:
//   - feeds.js: ok, items, feeds_ok, feeds_total, errors (per-feed)
//   - github-trending.js: ok, items, degraded (enrichment miss count), error
//   - bash fetchers: ok, items, error (on failure)
export const FetchOutputSchema = z.object({
  ok: z.boolean(),
  items: z.array(FeedItemSchema),
  feeds_ok: z.number().int().nonnegative().optional(),
  feeds_total: z.number().int().nonnegative().optional(),
  // github-search.js emits these; same semantics as feeds_ok/feeds_total but
  // counted per topic instead of per feed.
  topics_ok: z.number().int().nonnegative().optional(),
  topics_total: z.number().int().nonnegative().optional(),
  degraded: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  errors: z
    .array(
      z.object({
        feed: z.string(),
        error: z.string(),
      }),
    )
    .optional(),
});
