// Schema for data/staging/metadata.json — the contract between Stage 1
// (src/collect.js) and Stage 2 (scripts/curate.sh).
//
// Sources fields beyond the original 4 (leaderboards, mops, hf_trending,
// arxiv) are optional so legacy staging produced before the IA redesign
// still validates.

import { z } from 'zod';

const SourceHealthSchema = z.object({
  ok: z.boolean(),
  count: z.number().int().nonnegative(),
});

export const StagingMetadataSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  run_id: z.string().uuid().optional(),
  pipeline_version: z.string().optional(),
  collected_at: z.string(),
  timezone: z.string(),
  // `.strict()`: every entry must be a declared {ok,count} health record. This
  // is the layer that turns "a non-health field snuck into sources" into a hard
  // Stage-1 abort, instead of a silent strip that only detonates at Stage 4
  // (sources is copied verbatim into report meta.source_health). Adding a new
  // source means declaring it here first — the repo's schema-first discipline.
  sources: z
    .object({
      feeds: SourceHealthSchema,
      trending: SourceHealthSchema,
      search: SourceHealthSchema,
      developers: SourceHealthSchema,
      leaderboards: SourceHealthSchema.optional(),
      mops: SourceHealthSchema.optional(),
      hf_trending: SourceHealthSchema.optional(),
      arxiv: SourceHealthSchema.optional(),
    })
    .strict(),
  // Per-section feed item counts; written by Stage 1 once section slices are
  // enabled (Plan 2, Task 4). A sibling of `sources` — NOT a member — so the
  // downstream report source_health map stays a uniform {ok,count} record
  // (Stage 4 copies `sources` into meta.source_health wholesale). Optional so
  // legacy staging files still validate.
  feeds_sections: z.record(z.string(), z.number().int().nonnegative()).optional(),
  degraded: z.array(z.string()).default([]),
});
