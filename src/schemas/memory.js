// Schema for data/memory.json — v2 cross-day state managed by the agent.
//
// Top-level is strict (no .passthrough()) so a new stray key landing here
// — e.g. from a prompt drift or an accidental field rename — fails the
// validation gate and surfaces as a clear error, instead of silently being
// ignored by both the schema and the templates. Individual sub-objects
// (short_term, long_term) still use .passthrough() because their interior
// shape is agent-managed and benign to extend.

import { z } from 'zod';

export const MemorySchema = z.object({
  schema_version: z.literal(2),
  last_updated: z.string().nullable(),
  short_term: z.object({}).passthrough().nullable().optional(),
  long_term: z.object({}).passthrough().nullable().optional(),
  topics: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  narrative_arcs: z.array(z.unknown()).optional(),
  open_threads: z.array(z.unknown()).optional(),
  predictions: z.array(z.unknown()).optional(),
  engagement: z.unknown().optional(),
});
