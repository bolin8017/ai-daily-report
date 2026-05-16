// FeedSourceSchema — the shape of a single feed entry in config.json
// sources.feeds[] and in each lens's sources_overlay.feeds[].
//
// Extracted to its own module to break a circular import between
// config.js (which composes ConfigSchema using LensConfigSchema) and
// lens.js (which composes LensConfigSchema using FeedSourceSchema).
// Now both import from this module; no cycle.

import { z } from 'zod';

export const FeedSourceSchema = z.discriminatedUnion('type', [
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
