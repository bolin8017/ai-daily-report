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
  sources: z.object({
    feeds: SourceHealthSchema,
    trending: SourceHealthSchema,
    search: SourceHealthSchema,
    developers: SourceHealthSchema,
    leaderboards: SourceHealthSchema.optional(),
    mops: SourceHealthSchema.optional(),
    hf_trending: SourceHealthSchema.optional(),
    arxiv: SourceHealthSchema.optional(),
  }),
  degraded: z.array(z.string()).default([]),
});
