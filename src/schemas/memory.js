// Schema for data/memory.json — v2 cross-day state managed by the agent.

import { z } from 'zod';

export const MemorySchema = z
  .object({
    schema_version: z.literal(2),
    last_updated: z.string(),
    short_term: z.object({}).passthrough().optional(),
    long_term: z.object({}).passthrough().optional(),
    topics: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
    narrative_arcs: z.array(z.unknown()).optional(),
    open_threads: z.array(z.unknown()).optional(),
    predictions: z.array(z.unknown()).optional(),
    engagement: z.unknown().optional(),
  })
  .passthrough();
