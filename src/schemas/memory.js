// Schema for data/memory.json — v2 cross-day state managed by the agent.
//
// Top-level is strict (no .passthrough()) so a new stray key landing here
// — e.g. from a prompt drift or an accidental field rename — fails the
// validation gate and surfaces as a clear error, instead of silently being
// ignored by both the schema and the templates. Individual sub-objects
// (short_term, long_term) still use .passthrough() because their interior
// shape is agent-managed and benign to extend.

import { z } from 'zod';

// Per-audience track within audience_state. Each track carries its own
// topic frequency map and narrative arcs so general-builder narrative drift
// doesn't pollute Phison work-context arcs (and vice versa).
const AudienceTrackSchema = z
  .object({
    topics: z.record(z.string(), z.unknown()).optional(),
    narrative_arcs: z.array(z.unknown()).optional(),
  })
  .passthrough();

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
  // NEW in v2 IA redesign — per-audience tracks. Optional so backfilled v1 memory still validates.
  audience_state: z
    .object({
      general: AudienceTrackSchema.optional(),
      work: AudienceTrackSchema.optional(),
    })
    .optional(),
});

// LensMemorySchema — extends MemorySchema for non-default lens memory files.
// Each lens has its own data/memory/<id>.json; this schema adds lens-specific
// tracking (persona coverage for starvation-prevention rotation, open questions
// the lens flagged to owner, rejected axes) on top of the base memory shape.
//
// Unlike the strict MemorySchema, LensMemorySchema uses .passthrough() at the
// top level — newer lenses may evolve their own state fields, and lens prompts
// drift more often than the core memory shape.

const PersonaCoverageEntrySchema = z
  .object({
    last_focus_idea: z.string().optional(),
    days_since: z.number().int().nonnegative().optional(),
    times_featured: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const LensStateSchema = z
  .object({
    persona_coverage: z.record(z.string(), PersonaCoverageEntrySchema).optional(),
    open_questions: z
      .array(
        z.object({
          q: z.string(),
          asked_at: z.string(),
          related_to: z.string().optional(),
        }),
      )
      .optional(),
    rejected_axes: z.array(z.string()).optional(),
  })
  .passthrough();

export const LensMemorySchema = MemorySchema.extend({
  lens_id: z.string(),
  lens_state: LensStateSchema.optional(),
}).passthrough();
